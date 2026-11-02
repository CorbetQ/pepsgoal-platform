import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from '../db/client.js';
import { me, requireUser } from '../lib/guards.js';
import { toPublicUser, type Row } from '../lib/mappers.js';

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * Ligue de la semaine : flammes gagnées du lundi au dimanche par soi et ses amis (validations non contestées).
 * La semaine est celle du client (`from`, un lundi), pour suivre son fuseau horaire.
 */
export default async function leagueRoutes(app: FastifyInstance) {
  app.get('/v1/leagues/week', { preHandler: requireUser }, async req => {
    const u = me(req);
    const { from } = z.object({ from: Day }).parse(req.query);
    const friends = await sql<Row[]>`
      select x.id, x.username, x.display_name, x.avatar, x.role
      from friendships f join users x on x.id = case when f.requester_id = ${u.id} then f.addressee_id else f.requester_id end
      where f.status = 'accepted' and (f.requester_id = ${u.id} or f.addressee_id = ${u.id})
        and x.deleted_at is null and not (x.ban_permanent or coalesce(x.ban_until > now(), false))`;
    const [self] = await sql<Row[]>`select id, username, display_name, avatar, role from users where id = ${u.id}`;
    const people: Row[] = self ? [self, ...friends] : friends;
    const ids = people.map(p => p.id as string);
    const pts = await sql<Row[]>`
      select user_id, coalesce(sum(points), 0)::int as points, count(distinct date)::int as days from checkins
      where user_id in ${sql(ids)} and deleted_at is null and pending = false and kind not in ('relapse', 'use')
        and date >= ${from}::date and date < ${from}::date + 7
      group by user_id`;
    const of = (id: string) => pts.find(p => p.user_id === id);
    return people
      .map(p => ({ user: toPublicUser(p), points: of(p.id)?.points ?? 0, days: of(p.id)?.days ?? 0 }))
      .sort((a, b) => b.points - a.points || b.days - a.days);
  });
}
