import type { FastifyInstance } from 'fastify';
import type postgres from 'postgres';
import { ZodError } from 'zod';
import {
  CheckinSchema, GoalGroupSchema, GoalSchema, POINTS, PullQuery, PushRequest, SOCIAL_GOAL_TYPES, UserSettingsSchema,
  parseGoalData, resolveLww, type GoalType, type PullResponse, type PushResponse, type RejectReason, type SyncOp
} from '@pepsgoal/shared';
import { sql } from '../db/client.js';
import { forbidden, notFound } from '../lib/errors.js';
import { me, requireUser, type AuthUser } from '../lib/guards.js';
import { iso, toCheckin, toGoal, toGoalGroup, type Row } from '../lib/mappers.js';
import { notify } from '../lib/notify.js';

type Tx = postgres.TransactionSql;
class Reject extends Error { constructor(public reason: RejectReason) { super(reason); } }
const LIMIT = 500;
const nextRev = (tx: Tx) => tx`nextval('sync_rev_seq')`;

async function friendIds(tx: Tx, userId: string): Promise<Set<string>> {
  const rows = await tx<{ id: string }[]>`
    select case when requester_id = ${userId} then addressee_id else requester_id end as id
    from friendships where status = 'accepted' and (requester_id = ${userId} or addressee_id = ${userId})`;
  return new Set(rows.map(r => r.id));
}

async function applyOp(tx: Tx, u: AuthUser, op: SyncOp): Promise<void> {
  if (op.entity === 'goal') {
    const [cur] = await tx<Row[]>`select owner_id, updated_at from goals where id = ${op.id}`;
    if (cur && cur.owner_id !== u.id) throw new Reject('forbidden');
    const lww = resolveLww(iso(cur?.updated_at), op.clientUpdatedAt);
    if (!lww.accept) throw new Reject('stale');
    if (op.action === 'delete') {
      if (cur) await tx`update goals set deleted_at = now(), updated_at = ${lww.effectiveUpdatedAt}, rev = ${nextRev(tx)} where id = ${op.id}`;
      return;
    }
    const g = GoalSchema.parse({ ...op.data, id: op.id, ownerId: u.id });
    const data = parseGoalData(g.type, g.data);
    const friends = await friendIds(tx, u.id);
    // Un groupe d'objectifs doit appartenir à l'utilisateur ; un binôme ou un membre doit être un ami
    const groupId = g.groupId && (await tx`select 1 from goal_groups where id = ${g.groupId} and owner_id = ${u.id}`).length ? g.groupId : null;
    const buddyId = g.buddyId && friends.has(g.buddyId) ? g.buddyId : null;
    await tx`
      insert into goals (id, owner_id, type, title, icon, note, visibility, group_id, archived, completed_at, failed_at, data, buddy_id, buddy_verify, buddy_miss, created_at, updated_at, rev)
      values (${g.id}, ${u.id}, ${g.type}, ${g.title}, ${g.icon}, ${g.note}, ${g.visibility}, ${groupId}, ${g.archived}, ${g.completedAt}, ${g.failedAt},
              ${tx.json(data as postgres.JSONValue)}, ${buddyId}, ${!!buddyId && g.buddyVerify}, ${!!buddyId && g.buddyMiss}, ${g.createdAt}, ${lww.effectiveUpdatedAt}, ${nextRev(tx)})
      on conflict (id) do update set type = excluded.type, title = excluded.title, icon = excluded.icon, note = excluded.note, visibility = excluded.visibility,
        group_id = excluded.group_id, archived = excluded.archived, completed_at = excluded.completed_at, failed_at = excluded.failed_at, data = excluded.data,
        buddy_id = excluded.buddy_id, buddy_verify = excluded.buddy_verify, buddy_miss = excluded.buddy_miss, updated_at = excluded.updated_at,
        rev = excluded.rev, deleted_at = null`;
    if (SOCIAL_GOAL_TYPES.includes(g.type)) {
      const members = [u.id, ...g.memberIds.filter(id => friends.has(id))];
      if (members.length < 2) throw new Reject('invalid');
      await tx`delete from goal_members where goal_id = ${g.id} and not (user_id = any(${members}))`;
      for (const m of members) await tx`insert into goal_members (goal_id, user_id) values (${g.id}, ${m}) on conflict do nothing`;
    }
    return;
  }

  if (op.entity === 'checkin') {
    const [cur] = await tx<Row[]>`select user_id, updated_at from checkins where id = ${op.id}`;
    if (cur && cur.user_id !== u.id) throw new Reject('forbidden');
    const lww = resolveLww(iso(cur?.updated_at), op.clientUpdatedAt);
    if (!lww.accept) throw new Reject('stale');
    if (op.action === 'delete') {
      if (cur) await tx`update checkins set deleted_at = now(), updated_at = ${lww.effectiveUpdatedAt}, rev = ${nextRev(tx)} where id = ${op.id}`;
      return;
    }
    const c = CheckinSchema.parse({ points: 0, ...op.data, id: op.id, userId: u.id });
    const [goal] = await tx<Row[]>`
      select g.type, g.owner_id, g.buddy_id, g.buddy_verify, g.title from goals g
      where g.id = ${c.goalId} and g.deleted_at is null
        and (g.owner_id = ${u.id} or exists (select 1 from goal_members m where m.goal_id = g.id and m.user_id = ${u.id}))`;
    if (!goal) throw new Reject('not_found');
    // Les points sont plafonnés côté serveur : base du type + bonus éventuel de palier (200 max)
    const base = POINTS[goal.type as GoalType] ?? 10;
    const points = c.kind === 'relapse' || c.kind === 'use' ? 0 : Math.min(c.points || base, base + 200);
    const pending = !cur && goal.owner_id === u.id && goal.buddy_verify && !!goal.buddy_id && ['done', 'progress', 'measure'].includes(c.kind);
    await tx`
      insert into checkins (id, goal_id, user_id, date, kind, value, points, pending, task_id, created_at, updated_at, rev)
      values (${c.id}, ${c.goalId}, ${u.id}, ${c.date}, ${c.kind}, ${c.value}, ${points}, ${pending}, ${c.taskId}, ${c.createdAt}, ${lww.effectiveUpdatedAt}, ${nextRev(tx)})
      on conflict (id) do update set date = excluded.date, kind = excluded.kind, value = excluded.value, points = excluded.points, task_id = excluded.task_id,
        updated_at = excluded.updated_at, rev = excluded.rev, deleted_at = null`;
    if (pending) await notify(tx, goal.buddy_id, 'verify', `${u.displayName} te demande de confirmer « ${goal.title} » (${c.date}).`, { checkinId: c.id });
    return;
  }

  if (op.entity === 'goalGroup') {
    const [cur] = await tx<Row[]>`select owner_id, updated_at from goal_groups where id = ${op.id}`;
    if (cur && cur.owner_id !== u.id) throw new Reject('forbidden');
    const lww = resolveLww(iso(cur?.updated_at), op.clientUpdatedAt);
    if (!lww.accept) throw new Reject('stale');
    if (op.action === 'delete') {
      if (cur) await tx`update goal_groups set deleted_at = now(), updated_at = ${lww.effectiveUpdatedAt}, rev = ${nextRev(tx)} where id = ${op.id}`;
      return;
    }
    const gg = GoalGroupSchema.parse({ ...op.data, id: op.id, ownerId: u.id });
    await tx`
      insert into goal_groups (id, owner_id, name, icon, updated_at, rev) values (${gg.id}, ${u.id}, ${gg.name}, ${gg.icon}, ${lww.effectiveUpdatedAt}, ${nextRev(tx)})
      on conflict (id) do update set name = excluded.name, icon = excluded.icon, updated_at = excluded.updated_at, rev = excluded.rev, deleted_at = null`;
    return;
  }

  // Réglages du compte
  const [row] = await tx<Row[]>`select settings from users where id = ${u.id}`;
  const lww = resolveLww((row?.settings?.updatedAt as string | undefined) ?? null, op.clientUpdatedAt);
  if (!lww.accept) throw new Reject('stale');
  const s = UserSettingsSchema.parse({ ...op.data, updatedAt: lww.effectiveUpdatedAt });
  await tx`update users set settings = ${tx.json(s as postgres.JSONValue)}, settings_rev = ${nextRev(tx)} where id = ${u.id}`;
}

export default async function syncRoutes(app: FastifyInstance) {
  /** Envoi de la file d'attente de l'appareil. Chaque opération est appliquée dans sa propre transaction. */
  app.post('/v1/sync/push', { preHandler: requireUser, bodyLimit: 2 * 1024 * 1024 }, async req => {
    const u = me(req);
    const body = PushRequest.parse(req.body);
    const res: PushResponse = { applied: [], rejected: [], serverTime: '' };
    for (const op of body.ops) {
      try {
        await sql.begin(async tx => {
          const fresh = await tx`insert into sync_ops (op_id, user_id) values (${op.opId}, ${u.id}) on conflict do nothing returning op_id`;
          if (fresh.length) await applyOp(tx, u, op); // déjà appliquée : rien à refaire
        });
        res.applied.push(op.opId);
      } catch (e) {
        if (e instanceof Reject) res.rejected.push({ opId: op.opId, reason: e.reason });
        else if (e instanceof ZodError) res.rejected.push({ opId: op.opId, reason: 'invalid', message: e.issues[0]?.message });
        else throw e;
      }
    }
    res.serverTime = new Date().toISOString();
    return res;
  });

  /** Tout ce qui a changé depuis la révision `cursor` (objectifs, validations, groupes, réglages, suppressions). */
  app.get('/v1/sync/pull', { preHandler: requireUser }, async (req): Promise<PullResponse> => {
    const u = me(req);
    const { cursor } = PullQuery.parse(req.query);
    const goals = await sql<Row[]>`
      select g.*, coalesce((select array_agg(m.user_id) from goal_members m where m.goal_id = g.id), '{}') as member_ids
      from goals g
      where g.rev > ${cursor} and (g.owner_id = ${u.id} or g.buddy_id = ${u.id} or exists (select 1 from goal_members m where m.goal_id = g.id and m.user_id = ${u.id}))
      order by g.rev limit ${LIMIT}`;
    const checkins = await sql<Row[]>`
      select c.* from checkins c
      where c.rev > ${cursor} and (c.user_id = ${u.id} or c.goal_id in (
        select id from goals where owner_id = ${u.id} or buddy_id = ${u.id} union select goal_id from goal_members where user_id = ${u.id}))
      order by c.rev limit ${LIMIT}`;
    const groups = await sql<Row[]>`select * from goal_groups where owner_id = ${u.id} and rev > ${cursor} order by rev limit ${LIMIT}`;
    const [settingsRow] = await sql<Row[]>`select settings, settings_rev from users where id = ${u.id} and settings_rev > ${cursor}`;

    const tables = [goals, checkins, groups];
    const full = tables.filter(t => t.length === LIMIT);
    const lastRev = (t: Row[]) => Number(t[t.length - 1]?.rev ?? cursor);
    const maxRev = Math.max(cursor, ...tables.map(lastRev), Number(settingsRow?.settings_rev ?? 0));
    // Si une table a atteint la limite, on reprend à sa dernière révision pour ne rien sauter
    const next = full.length ? Math.min(...full.map(lastRev)) : maxRev;

    const deleted: PullResponse['deleted'] = [];
    const alive = <T>(rows: Row[], entity: 'goal' | 'checkin' | 'goalGroup', map: (r: Row) => T): T[] =>
      rows.filter(r => { if (r.deleted_at) { deleted.push({ entity, id: r.id }); return false; } return true; }).map(map);
    return {
      cursor: next, hasMore: full.length > 0,
      goals: alive(goals, 'goal', toGoal), checkins: alive(checkins, 'checkin', toCheckin), goalGroups: alive(groups, 'goalGroup', toGoalGroup),
      settings: settingsRow ? UserSettingsSchema.parse(settingsRow.settings ?? {}) : null, deleted
    };
  });

  /** Binôme de motivation : confirmer ou refuser une validation en attente. */
  for (const decision of ['confirm', 'refuse'] as const) {
    app.post(`/v1/checkins/:id/${decision}`, { preHandler: requireUser }, async req => {
      const { id } = req.params as { id: string };
      const u = me(req);
      return sql.begin(async tx => {
        const [c] = await tx<Row[]>`select c.*, g.buddy_id, g.title from checkins c join goals g on g.id = c.goal_id where c.id = ${id} and c.pending and c.deleted_at is null`;
        if (!c) throw notFound('Validation introuvable ou déjà traitée.');
        if (c.buddy_id !== u.id) throw forbidden();
        if (decision === 'confirm') {
          await tx`update checkins set pending = false, rev = ${nextRev(tx)} where id = ${id}`;
          await notify(tx, c.user_id, 'verify', `${u.displayName} a confirmé « ${c.title} ».`);
        } else {
          await tx`update checkins set deleted_at = now(), rev = ${nextRev(tx)} where id = ${id}`;
          await notify(tx, c.user_id, 'verify', `${u.displayName} n'a pas confirmé « ${c.title} » du ${c.date}.`);
        }
        return { ok: true };
      });
    });
  }
}
