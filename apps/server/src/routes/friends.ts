import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { globalStreak, Id } from '@pepsgoal/shared';
import { sql } from '../db/client.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { isBlocked, me, requireSocial, requireUser } from '../lib/guards.js';
import { toPublicUser, type Row } from '../lib/mappers.js';
import { notify } from '../lib/notify.js';

const params = (p: unknown) => z.object({ id: Id }).parse(p);

export default async function friendRoutes(app: FastifyInstance) {
  app.get('/v1/users/search', { preHandler: requireUser }, async req => {
    const { q } = z.object({ q: z.string().trim().max(40).default('') }).parse(req.query);
    const u = me(req);
    const like = `%${q.replace(/[\\%_]/g, m => '\\' + m)}%`;
    const rows = await sql<Row[]>`
      select id, username, display_name, avatar, role from users
      where deleted_at is null and role = 'user' and id <> ${u.id}
        and (username ilike ${like} or display_name ilike ${like})
        and not exists (select 1 from blocks b where (b.blocker_id = ${u.id} and b.blocked_id = users.id) or (b.blocker_id = users.id and b.blocked_id = ${u.id}))
      order by username limit 20`;
    return rows.map(toPublicUser);
  });

  app.get('/v1/friends', { preHandler: requireUser }, async req => {
    const u = me(req);
    const rows = await sql<Row[]>`
      select f.id as friendship_id, f.status, f.requester_id, f.created_at, x.id, x.username, x.display_name, x.avatar, x.role
      from friendships f join users x on x.id = case when f.requester_id = ${u.id} then f.addressee_id else f.requester_id end
      where (f.requester_id = ${u.id} or f.addressee_id = ${u.id}) and x.deleted_at is null`;
    const pick = (r: Row) => ({ friendshipId: r.friendship_id, user: toPublicUser(r) });
    // Séries des amis, pour le classement des flammes (jours avec au moins une réussite)
    const ids = [...rows.filter(r => r.status === 'accepted').map(r => r.id as string), u.id];
    const days = await sql<Row[]>`
      select user_id, array_agg(distinct date::text) as days from checkins
      where user_id in ${sql(ids)} and deleted_at is null and pending = false and kind not in ('relapse', 'use') and date >= current_date - 400
      group by user_id`;
    const streakOf = (id: string) => globalStreak(new Set((days.find(d => d.user_id === id)?.days as string[] | undefined) ?? [])).n;
    return {
      myStreak: streakOf(u.id),
      friends: rows.filter(r => r.status === 'accepted').map(r => ({ ...pick(r), streak: streakOf(r.id) })),
      incoming: rows.filter(r => r.status === 'pending' && r.requester_id !== u.id).map(pick),
      outgoing: rows.filter(r => r.status === 'pending' && r.requester_id === u.id).map(pick)
    };
  });

  app.post('/v1/friends/requests', { preHandler: requireSocial, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { userId } = z.object({ userId: Id }).parse(req.body);
    const u = me(req);
    if (userId === u.id) throw badRequest('Tu ne peux pas t’ajouter toi-même.');
    const [target] = await sql<Row[]>`select id, role from users where id = ${userId} and deleted_at is null`;
    if (!target || target.role !== 'user') throw notFound('Compte introuvable.');
    if (await isBlocked(u.id, userId)) throw forbidden('Impossible d’ajouter ce compte.');
    const [existing] = await sql`select 1 from friendships where (requester_id = ${u.id} and addressee_id = ${userId}) or (requester_id = ${userId} and addressee_id = ${u.id})`;
    if (existing) throw conflict('Une demande existe déjà avec ce compte.');
    const [f] = await sql<Row[]>`insert into friendships (requester_id, addressee_id) values (${u.id}, ${userId}) returning id`;
    await notify(sql, userId, 'friend', `${u.displayName} t'a envoyé une demande d'ami.`, { friendshipId: f!.id });
    reply.status(201);
    return { id: f!.id };
  });

  app.post('/v1/friends/requests/:id/accept', { preHandler: requireSocial }, async req => {
    const { id } = params(req.params);
    const u = me(req);
    const [f] = await sql<Row[]>`update friendships set status = 'accepted' where id = ${id} and addressee_id = ${u.id} and status = 'pending' returning requester_id`;
    if (!f) throw notFound('Demande introuvable.');
    await notify(sql, f.requester_id, 'friend', `${u.displayName} a accepté ta demande d'ami.`);
    return { ok: true };
  });

  app.post('/v1/friends/requests/:id/decline', { preHandler: requireUser }, async req => {
    const { id } = params(req.params);
    const u = me(req);
    await sql`delete from friendships where id = ${id} and (addressee_id = ${u.id} or requester_id = ${u.id}) and status = 'pending'`;
    return { ok: true };
  });

  app.delete('/v1/friends/:id', { preHandler: requireUser }, async req => {
    const { id } = params(req.params);
    const u = me(req);
    await sql`delete from friendships where (requester_id = ${u.id} and addressee_id = ${id}) or (requester_id = ${id} and addressee_id = ${u.id})`;
    return { ok: true };
  });

  /** Bloquer un compte : supprime l'amitié, masque ses contenus et empêche tout contact. */
  app.post('/v1/users/:id/block', { preHandler: requireUser }, async req => {
    const { id } = params(req.params);
    const u = me(req);
    if (id === u.id) throw badRequest('Action impossible.');
    await sql.begin(async tx => {
      await tx`insert into blocks (blocker_id, blocked_id) values (${u.id}, ${id}) on conflict do nothing`;
      await tx`delete from friendships where (requester_id = ${u.id} and addressee_id = ${id}) or (requester_id = ${id} and addressee_id = ${u.id})`;
    });
    return { ok: true };
  });

  app.delete('/v1/users/:id/block', { preHandler: requireUser }, async req => {
    const { id } = params(req.params);
    await sql`delete from blocks where blocker_id = ${me(req).id} and blocked_id = ${id}`;
    return { ok: true };
  });
}
