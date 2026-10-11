import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Id, MessageBody } from '@pepsgoal/shared';
import { sql } from '../db/client.js';
import { forbidden } from '../lib/errors.js';
import { areFriends, isBlocked, me, requireSocial, requireUser } from '../lib/guards.js';
import { iso, toPublicUser, type Row } from '../lib/mappers.js';

const params = (p: unknown) => z.object({ id: Id }).parse(p);

export default async function messageRoutes(app: FastifyInstance) {
  /** Liste des conversations ; celle de PepsGoal Officiel est épinglée en premier. */
  app.get('/v1/conversations', { preHandler: requireUser }, async req => {
    const u = me(req);
    const rows = await sql<Row[]>`
      with conv as (
        select case when sender_id = ${u.id} then recipient_id else sender_id end as peer, max(created_at) as last_at
        from messages where sender_id = ${u.id} or recipient_id = ${u.id} group by 1
      )
      select c.peer, c.last_at, x.username, x.display_name, x.avatar, x.role,
        (select json_build_object('text', m.text, 'e2e', m.e2e) from messages m where (m.sender_id = c.peer and m.recipient_id = ${u.id}) or (m.sender_id = ${u.id} and m.recipient_id = c.peer) order by m.created_at desc limit 1) as last,
        (select count(*)::int from messages m where m.sender_id = c.peer and m.recipient_id = ${u.id} and m.read_at is null) as unread
      from conv c join users x on x.id = c.peer where x.deleted_at is null
      order by (x.role = 'official') desc, c.last_at desc`;
    return rows.map(r => ({ peer: toPublicUser({ ...r, id: r.peer }), lastText: r.last?.text ?? null, lastE2e: r.last?.e2e ?? null, lastAt: iso(r.last_at), unread: r.unread }));
  });

  app.get('/v1/conversations/:id', { preHandler: requireUser }, async req => {
    const { id } = params(req.params);
    const { before } = z.object({ before: z.string().datetime().optional() }).parse(req.query);
    const u = me(req);
    const rows = await sql<Row[]>`
      select id, sender_id, text, e2e, official, tag, created_at, read_at from messages
      where ((sender_id = ${u.id} and recipient_id = ${id}) or (sender_id = ${id} and recipient_id = ${u.id}))
        and created_at < ${before ?? new Date(Date.now() + 60_000).toISOString()}
      order by created_at desc limit 50`;
    await sql`update messages set read_at = now() where sender_id = ${id} and recipient_id = ${u.id} and read_at is null`;
    return rows.reverse().map(m => ({ id: m.id, mine: m.sender_id === u.id, text: m.text, e2e: m.e2e, official: m.official, tag: m.tag, createdAt: iso(m.created_at) }));
  });

  app.post('/v1/conversations/:id', { preHandler: requireSocial, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { id } = params(req.params);
    const { e2e } = MessageBody.parse(req.body);
    const u = me(req);
    const [peer] = await sql<Row[]>`select role from users where id = ${id} and deleted_at is null`;
    if (!peer || peer.role === 'official') throw forbidden('Ce compte ne reçoit pas de messages.');
    if (!(await areFriends(u.id, id)) || (await isBlocked(u.id, id))) throw forbidden('Vous devez être amis pour échanger des messages.');
    // La version de clé doit appartenir à cette conversation (le contenu, lui, reste illisible pour le serveur)
    const [a, b] = u.id < id ? [u.id, id] : [id, u.id];
    const [k] = await sql<Row[]>`select 1 from e2e_pair_keys where key_id = ${e2e.keyId} and user_a = ${a} and user_b = ${b}`;
    if (!k) throw forbidden('Clé de chiffrement inconnue pour cette conversation.');
    const [m] = await sql<Row[]>`insert into messages (sender_id, recipient_id, e2e) values (${u.id}, ${id}, ${sql.json(e2e)}) returning id, created_at`;
    reply.status(201);
    return { id: m!.id, createdAt: iso(m!.created_at) };
  });
}
