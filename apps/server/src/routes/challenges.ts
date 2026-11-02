import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Id } from '@pepsgoal/shared';
import { sql } from '../db/client.js';
import { badRequest, notFound } from '../lib/errors.js';
import { me, requireAdmin, requireSocial, requireUser } from '../lib/guards.js';
import { toPublicUser, type Row } from '../lib/mappers.js';

const params = (p: unknown) => z.object({ id: Id }).parse(p);
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ChallengeBody = z.object({
  title: z.string().trim().min(3).max(60),
  emoji: z.string().trim().min(1).max(16).default('🏁'),
  description: z.string().trim().max(400).default(''),
  startsOn: Day,
  endsOn: Day
}).refine(b => b.endsOn >= b.startsOn, 'La fin doit suivre le début.');

const dayStr = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
/** Un compte banni ou supprimé n'apparaît pas dans les classements. */
const visible = sql`u.deleted_at is null and not (u.ban_permanent or coalesce(u.ban_until > now(), false))`;

const toChallenge = (r: Row) => ({
  id: r.id, title: r.title, emoji: r.emoji, description: r.description, startsOn: dayStr(r.starts_on), endsOn: dayStr(r.ends_on),
  participants: r.participants ?? 0, joined: !!r.joined, myDays: (r.my_days ?? []).map(dayStr)
});

/**
 * Défis de la communauté : créés par la modération, rejoints par chacun, un jour validé à la fois.
 * Le classement (nom, avatar, nombre de jours) est visible par tous les participants.
 */
export default async function challengeRoutes(app: FastifyInstance) {
  // En cours, à venir et terminés depuis moins de 7 jours
  app.get('/v1/challenges', { preHandler: requireUser }, async req => {
    const u = me(req);
    const rows = await sql<Row[]>`
      select c.*,
        (select count(*)::int from challenge_members m join users u on u.id = m.user_id where m.challenge_id = c.id and ${visible}) as participants,
        exists (select 1 from challenge_members m where m.challenge_id = c.id and m.user_id = ${u.id}) as joined,
        (select coalesce(array_agg(d.day order by d.day), '{}') from challenge_days d where d.challenge_id = c.id and d.user_id = ${u.id}) as my_days
      from challenges c
      where c.deleted_at is null and c.ends_on >= current_date - 7
      order by c.starts_on, c.created_at`;
    return rows.map(toChallenge);
  });

  app.get('/v1/challenges/:id', { preHandler: requireUser }, async req => {
    const u = me(req); const { id } = params(req.params);
    const [c] = await sql<Row[]>`
      select c.*,
        (select count(*)::int from challenge_members m join users u on u.id = m.user_id where m.challenge_id = c.id and ${visible}) as participants,
        exists (select 1 from challenge_members m where m.challenge_id = c.id and m.user_id = ${u.id}) as joined,
        (select coalesce(array_agg(d.day order by d.day), '{}') from challenge_days d where d.challenge_id = c.id and d.user_id = ${u.id}) as my_days
      from challenges c where c.id = ${id} and c.deleted_at is null`;
    if (!c) throw notFound('Ce défi n’existe plus.');
    const board = await sql<Row[]>`
      select u.id, u.username, u.display_name, u.avatar, u.role,
        (select count(*)::int from challenge_days d where d.challenge_id = ${id} and d.user_id = u.id) as days, m.joined_at
      from challenge_members m join users u on u.id = m.user_id
      where m.challenge_id = ${id} and ${visible}
      order by days desc, m.joined_at asc limit 50`;
    const total = Math.max(1, Math.round((Date.parse(dayStr(c.ends_on)) - Date.parse(dayStr(c.starts_on))) / 86400e3) + 1);
    return {
      ...toChallenge(c), totalDays: total,
      board: board.map((r, i) => ({ rank: i + 1, user: toPublicUser(r), days: r.days }))
    };
  });

  app.post('/v1/challenges/:id/join', { preHandler: requireSocial }, async req => {
    const u = me(req); const { id } = params(req.params);
    const [c] = await sql<Row[]>`select id from challenges where id = ${id} and deleted_at is null and ends_on >= current_date`;
    if (!c) throw badRequest('Ce défi est terminé.');
    await sql`insert into challenge_members (challenge_id, user_id) values (${id}, ${u.id}) on conflict do nothing`;
    return { ok: true };
  });

  app.delete('/v1/challenges/:id/join', { preHandler: requireUser }, async req => {
    const u = me(req); const { id } = params(req.params);
    await sql`delete from challenge_days where challenge_id = ${id} and user_id = ${u.id}`;
    await sql`delete from challenge_members where challenge_id = ${id} and user_id = ${u.id}`;
    return { ok: true };
  });

  // Jour validé (ou annulé) : dans la période du défi, et au plus tard demain (fuseaux horaires)
  const dayRoute = async (req: FastifyRequest, on: boolean) => {
    const u = me(req); const { id, day } = z.object({ id: Id, day: Day }).parse(req.params);
    const [c] = await sql<Row[]>`
      select c.id from challenges c join challenge_members m on m.challenge_id = c.id and m.user_id = ${u.id}
      where c.id = ${id} and c.deleted_at is null and ${day}::date between c.starts_on and c.ends_on and ${day}::date <= current_date + 1`;
    if (!c) throw badRequest('Jour hors de la période du défi, ou défi non rejoint.');
    if (on) await sql`insert into challenge_days (challenge_id, user_id, day) values (${id}, ${u.id}, ${day}) on conflict do nothing`;
    else await sql`delete from challenge_days where challenge_id = ${id} and user_id = ${u.id} and day = ${day}`;
    return { ok: true };
  };
  app.put('/v1/challenges/:id/days/:day', { preHandler: requireSocial, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async req => dayRoute(req, true));
  app.delete('/v1/challenges/:id/days/:day', { preHandler: requireUser }, async req => dayRoute(req, false));

  /* ---------- modération ---------- */
  app.post('/v1/admin/challenges', { preHandler: requireAdmin }, async req => {
    const u = me(req); const b = ChallengeBody.parse(req.body);
    const [c] = await sql<Row[]>`insert into challenges (title, emoji, description, starts_on, ends_on, created_by)
      values (${b.title}, ${b.emoji}, ${b.description}, ${b.startsOn}, ${b.endsOn}, ${u.id}) returning *`;
    return toChallenge({ ...c, participants: 0, joined: false, my_days: [] });
  });

  app.delete('/v1/admin/challenges/:id', { preHandler: requireAdmin }, async req => {
    const { id } = params(req.params);
    await sql`update challenges set deleted_at = now() where id = ${id}`;
    return { ok: true };
  });
}
