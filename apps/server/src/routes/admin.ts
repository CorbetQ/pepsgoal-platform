import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AnnouncementBody, AppealDecisionBody, BanBody, Id, MaintenanceBody, ReasonBody } from '@pepsgoal/shared';
import { sql } from '../db/client.js';
import { revokeAllSessions } from '../lib/auth.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { me, requireAdmin } from '../lib/guards.js';
import { invalidateMaintenanceCache } from '../lib/maintenance.js';
import { iso, toPublicUser, type Row } from '../lib/mappers.js';
import { logMod, modNotify, notify, officialMessage } from '../lib/notify.js';

const params = (p: unknown) => z.object({ id: Id }).parse(p);
const pre = { preHandler: requireAdmin };

/** Charge un compte modérable (ni admin, ni compte officiel). */
async function target(id: string): Promise<Row> {
  const [u] = await sql<Row[]>`select * from users where id = ${id} and deleted_at is null`;
  if (!u) throw notFound('Compte introuvable.');
  if (u.role !== 'user') throw forbidden('Ce compte ne peut pas être modéré.');
  return u;
}

export default async function adminRoutes(app: FastifyInstance) {
  app.get('/v1/admin/overview', pre, async () => {
    const [c] = await sql<Row[]>`select
      (select count(*)::int from users where role = 'user' and deleted_at is null) as users,
      (select count(*)::int from users where role = 'user' and (ban_permanent or ban_until > now())) as banned,
      (select count(*)::int from users where warned_at is not null) as warned,
      (select count(*)::int from posts where status = 'pending' and deleted_at is null) as pending_posts,
      (select count(distinct post_id)::int from reports where closed_at is null) as open_reports,
      (select count(*)::int from appeals where status = 'pending') as open_appeals`;
    return c;
  });

  /* ---------- comptes ---------- */
  app.get('/v1/admin/users', pre, async req => {
    const { q, filter } = z.object({ q: z.string().max(40).default(''), filter: z.enum(['all', 'banned', 'warned', 'muted', 'new']).default('all') }).parse(req.query);
    const like = `%${q.replace(/[\\%_]/g, m => '\\' + m)}%`;
    const rows = await sql<Row[]>`
      select id, username, display_name, avatar, role, warned_at, warn_reason, comments_restricted, ban_until, ban_permanent, ban_reason, created_at
      from users where deleted_at is null and role <> 'official' and (username ilike ${like} or display_name ilike ${like})
        and ${filter === 'banned' ? sql`(ban_permanent or ban_until > now())`
          : filter === 'warned' ? sql`warned_at is not null`
          : filter === 'muted' ? sql`comments_restricted`
          : filter === 'new' ? sql`created_at > now() - interval '7 days'` : sql`true`}
      order by created_at desc limit 100`;
    return rows.map(r => ({ ...toPublicUser(r), warnedAt: iso(r.warned_at), warnReason: r.warn_reason, commentsRestricted: r.comments_restricted, banUntil: iso(r.ban_until), banPermanent: r.ban_permanent, banReason: r.ban_reason, createdAt: iso(r.created_at) }));
  });

  app.post('/v1/admin/users/:id/warn', pre, async req => {
    const { id } = params(req.params); const { reason } = ReasonBody.parse(req.body); const u = await target(id);
    await sql.begin(async tx => {
      await tx`update users set warned_at = now(), warn_reason = ${reason} where id = ${id}`;
      await modNotify(tx, id, `Tu as reçu un avertissement de la modération${reason ? ` : ${reason}` : ''}. Tes prochaines publications seront vérifiées avant d'être visibles.`);
      await logMod(tx, me(req).id, 'Avertissement', id, `${u.display_name}${reason ? ` : ${reason}` : ''}`);
    });
    return { ok: true };
  });

  app.post('/v1/admin/users/:id/unwarn', pre, async req => {
    const { id } = params(req.params); const u = await target(id);
    await sql.begin(async tx => {
      await tx`update users set warned_at = null, warn_reason = null where id = ${id}`;
      await modNotify(tx, id, 'Ton avertissement a été levé : tes publications sont de nouveau visibles immédiatement.');
      await logMod(tx, me(req).id, 'Avertissement levé', id, u.display_name);
    });
    return { ok: true };
  });

  app.post('/v1/admin/users/:id/ban', pre, async req => {
    const { id } = params(req.params); const { days, reason } = BanBody.parse(req.body); const u = await target(id);
    const until = days ? new Date(Date.now() + days * 864e5).toISOString() : null;
    await sql.begin(async tx => {
      await tx`update users set ban_until = ${until}, ban_permanent = ${days == null}, ban_reason = ${reason} where id = ${id}`;
      await modNotify(tx, id, `Ton accès à la plateforme sociale est suspendu ${days ? `pendant ${days === 1 ? '24 heures' : `${days} jours`}` : 'définitivement'}${reason ? ` (motif : ${reason})` : ''}. Tu peux demander un débannissement depuis le Feed.`);
      await logMod(tx, me(req).id, days ? `Ban ${days} j` : 'Ban définitif', id, `${u.display_name}${reason ? ` : ${reason}` : ''}`);
    });
    return { ok: true };
  });

  app.post('/v1/admin/users/:id/unban', pre, async req => {
    const { id } = params(req.params); const u = await target(id);
    await sql.begin(async tx => {
      await tx`update users set ban_until = null, ban_permanent = false, ban_reason = null where id = ${id}`;
      await tx`update appeals set status = 'accepted', decided_at = now(), decided_by = ${me(req).id} where user_id = ${id} and status = 'pending'`;
      await modNotify(tx, id, 'Ton accès à la plateforme sociale est rétabli. Bon retour parmi nous !');
      await logMod(tx, me(req).id, 'Ban levé', id, u.display_name);
    });
    return { ok: true };
  });

  app.post('/v1/admin/users/:id/comments', pre, async req => {
    const { id } = params(req.params); const { restricted } = z.object({ restricted: z.boolean() }).parse(req.body); const u = await target(id);
    await sql.begin(async tx => {
      await tx`update users set comments_restricted = ${restricted} where id = ${id}`;
      await modNotify(tx, id, restricted ? 'La modération a restreint ta possibilité de commenter.' : 'Tu peux de nouveau commenter les publications.');
      await logMod(tx, me(req).id, restricted ? 'Commentaires restreints' : 'Commentaires autorisés', id, u.display_name);
    });
    return { ok: true };
  });

  app.post('/v1/admin/users/:id/message', pre, async req => {
    const { id } = params(req.params); const { text } = z.object({ text: z.string().trim().min(1).max(600) }).parse(req.body); const u = await target(id);
    await officialMessage(sql, id, text, 'mod');
    await logMod(sql, me(req).id, 'Message officiel', id, u.display_name);
    return { ok: true };
  });

  app.delete('/v1/admin/users/:id', pre, async req => {
    const { id } = params(req.params); const u = await target(id);
    await revokeAllSessions(id);
    await sql`delete from users where id = ${id}`;
    await logMod(sql, me(req).id, 'Compte supprimé', null, u.display_name);
    return { ok: true };
  });

  /* ---------- publications ---------- */
  app.get('/v1/admin/posts', pre, async req => {
    const { scope } = z.object({ scope: z.enum(['pending', 'reported', 'recent']).default('pending') }).parse(req.query);
    const rows = await sql<Row[]>`
      select p.*, a.username, a.display_name, a.avatar, a.role,
        (select count(*)::int from reports r where r.post_id = p.id and r.closed_at is null) as report_count,
        (select array_agg(distinct r.reason) from reports r where r.post_id = p.id and r.closed_at is null) as reasons
      from posts p join users a on a.id = p.author_id
      where p.deleted_at is null and ${scope === 'pending' ? sql`p.status = 'pending'`
        : scope === 'reported' ? sql`exists (select 1 from reports r where r.post_id = p.id and r.closed_at is null)` : sql`true`}
      order by ${scope === 'reported' ? sql`report_count desc,` : sql``} p.created_at desc limit 100`;
    return rows.map(p => ({ id: p.id, author: toPublicUser({ ...p, id: p.author_id }), text: p.text, visibility: p.visibility, status: p.status, commentsLocked: p.comments_locked, createdAt: iso(p.created_at), reportCount: p.report_count, reasons: p.reasons ?? [] }));
  });

  for (const action of ['approve', 'reject', 'delete', 'lock', 'unlock', 'dismiss'] as const) {
    app.post(`/v1/admin/posts/:id/${action}`, pre, async req => {
      const { id } = params(req.params);
      const admin = me(req).id;
      return sql.begin(async tx => {
        const [p] = await tx<Row[]>`select p.*, a.display_name from posts p join users a on a.id = p.author_id where p.id = ${id} and p.deleted_at is null`;
        if (!p) throw notFound('Publication introuvable.');
        const short = `« ${p.text.slice(0, 50)}${p.text.length > 50 ? '…' : ''} »`;
        if (action === 'approve') { await tx`update posts set status = 'visible' where id = ${id}`; await modNotify(tx, p.author_id, 'Ta publication a été validée par la modération : elle est maintenant visible.'); }
        if (action === 'reject' || action === 'delete') {
          await tx`update posts set deleted_at = now() where id = ${id}`;
          await tx`update reports set closed_at = now() where post_id = ${id} and closed_at is null`;
          await modNotify(tx, p.author_id, action === 'reject' ? `Ta publication n'a pas été validée par la modération : ${short}.` : 'Une de tes publications a été supprimée par la modération car elle ne respectait pas les règles de la communauté.');
        }
        if (action === 'lock' || action === 'unlock') {
          await tx`update posts set comments_locked = ${action === 'lock'} where id = ${id}`;
          await modNotify(tx, p.author_id, action === 'lock' ? `La modération a fermé les commentaires de ta publication ${short}.` : 'Les commentaires de ta publication sont rouverts.');
        }
        if (action === 'dismiss') await tx`update reports set closed_at = now() where post_id = ${id} and closed_at is null`;
        const label = { approve: 'Publication validée', reject: 'Publication refusée', delete: 'Publication supprimée', lock: 'Commentaires fermés', unlock: 'Commentaires rouverts', dismiss: 'Signalement ignoré' }[action];
        await logMod(tx, admin, label, p.author_id, p.display_name);
        return { ok: true };
      });
    });
  }

  /* ---------- contestations ---------- */
  app.get('/v1/admin/appeals', pre, async req => {
    const { status } = z.object({ status: z.enum(['pending', 'done']).default('pending') }).parse(req.query);
    const rows = await sql<Row[]>`
      select a.*, u.username, u.display_name, u.avatar, u.role, u.ban_until, u.ban_permanent, u.ban_reason
      from appeals a join users u on u.id = a.user_id
      where ${status === 'pending' ? sql`a.status = 'pending'` : sql`a.status <> 'pending'`}
      order by a.created_at desc limit 100`;
    return rows.map(a => ({ id: a.id, user: toPublicUser({ ...a, id: a.user_id }), text: a.text, status: a.status, answer: a.answer, createdAt: iso(a.created_at), decidedAt: iso(a.decided_at), ban: { until: iso(a.ban_until), permanent: a.ban_permanent, reason: a.ban_reason } }));
  });

  for (const decision of ['accept', 'refuse'] as const) {
    app.post(`/v1/admin/appeals/:id/${decision}`, pre, async req => {
      const { id } = params(req.params); const { answer } = AppealDecisionBody.parse(req.body);
      return sql.begin(async tx => {
        const [a] = await tx<Row[]>`update appeals set status = ${decision === 'accept' ? 'accepted' : 'refused'}, answer = ${answer}, decided_at = now(), decided_by = ${me(req).id}
          where id = ${id} and status = 'pending' returning user_id`;
        if (!a) throw notFound('Contestation introuvable ou déjà traitée.');
        if (decision === 'accept') await tx`update users set ban_until = null, ban_permanent = false, ban_reason = null where id = ${a.user_id}`;
        await modNotify(tx, a.user_id, decision === 'accept'
          ? `Ta demande de débannissement est acceptée${answer ? ` : « ${answer} »` : ''}. Ton accès social est rétabli.`
          : `Ta demande de débannissement est refusée${answer ? ` : « ${answer} »` : ''}.`);
        await logMod(tx, me(req).id, decision === 'accept' ? 'Débannissement accepté' : 'Débannissement refusé', a.user_id);
        return { ok: true };
      });
    });
  }

  /* ---------- maintenances ---------- */
  app.get('/v1/admin/maintenance', pre, async () => {
    const rows = await sql<Row[]>`select * from maintenance order by created_at desc limit 20`;
    return rows.map(m => ({ id: m.id, mode: m.mode, startsAt: iso(m.starts_at), endsAt: iso(m.ends_at), message: m.message, endedAt: iso(m.ended_at) }));
  });

  app.post('/v1/admin/maintenance', pre, async (req, reply) => {
    const b = MaintenanceBody.parse(req.body);
    if (b.endsAt && Date.parse(b.endsAt) <= Math.max(Date.parse(b.startsAt), Date.now())) throw badRequest('La fin doit être après le début et dans le futur.');
    const [active] = await sql`select 1 from maintenance where ended_at is null and (ends_at is null or ends_at > now())`;
    if (active) throw badRequest('Une maintenance est déjà programmée ou en cours.');
    await sql.begin(async tx => {
      await tx`insert into maintenance (mode, starts_at, ends_at, message, created_by) values (${b.mode}, ${b.startsAt}, ${b.endsAt}, ${b.message}, ${me(req).id})`;
      if (b.notify) {
        const text = `Maintenance prévue le ${new Date(b.startsAt).toLocaleString('fr-FR')}${b.endsAt ? ` jusqu'au ${new Date(b.endsAt).toLocaleString('fr-FR')}` : ''} : ${b.mode === 'full' ? "l'application sera indisponible" : 'les fonctions sociales passent en lecture seule'}. ${b.message || 'Tes objectifs et ta série sont protégés.'}`;
        const from = await tx<{ id: string }[]>`select id from users where role = 'official' limit 1`;
        if (from[0]) await tx`insert into messages (sender_id, recipient_id, text, official, tag) select ${from[0].id}, id, ${text}, true, 'info' from users where role = 'user' and deleted_at is null`;
      }
      await logMod(tx, me(req).id, 'Maintenance programmée', null, b.mode);
    });
    invalidateMaintenanceCache();
    reply.status(201);
    return { ok: true };
  });

  app.post('/v1/admin/maintenance/end', pre, async req => {
    await sql`update maintenance set ended_at = now() where ended_at is null`;
    await logMod(sql, me(req).id, 'Maintenance terminée', null);
    invalidateMaintenanceCache();
    return { ok: true };
  });

  /* ---------- annonces (compte PepsGoal Officiel) ---------- */
  app.post('/v1/admin/announcements', pre, async req => {
    const b = AnnouncementBody.parse(req.body);
    if (b.toUserId) await target(b.toUserId);
    return sql.begin(async tx => {
      if (b.toUserId) {
        await officialMessage(tx, b.toUserId, b.text, b.tag);
        await logMod(tx, me(req).id, 'Message officiel', b.toUserId);
        return { sent: 1 };
      }
      const [from] = await tx<{ id: string }[]>`select id from users where role = 'official' limit 1`;
      if (!from) throw badRequest('Compte officiel introuvable.');
      if (b.tag === 'news') await tx`insert into announcements (text, tag, created_by) values (${b.text}, ${b.tag}, ${me(req).id})`;
      const r = await tx`insert into messages (sender_id, recipient_id, text, official, tag) select ${from.id}, id, ${b.text}, true, ${b.tag} from users where role = 'user' and deleted_at is null`;
      await tx`insert into notifications (user_id, type, text) select id, 'official', ${`PepsGoal Officiel : ${b.text.slice(0, 90)}`} from users where role = 'user' and deleted_at is null`;
      await logMod(tx, me(req).id, 'Annonce officielle', null, b.tag);
      return { sent: r.count };
    });
  });

  app.get('/v1/admin/modlog', pre, async () => {
    const rows = await sql<Row[]>`select m.*, a.display_name as admin_name from mod_actions m left join users a on a.id = m.admin_id order by m.created_at desc limit 100`;
    return rows.map(m => ({ id: m.id, action: m.action, detail: m.detail, adminName: m.admin_name, targetUserId: m.target_user_id, createdAt: iso(m.created_at) }));
  });
}
