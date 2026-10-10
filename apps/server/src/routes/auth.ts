import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LoginBody, Password, RegisterBody } from '@pepsgoal/shared';
import { sql } from '../db/client.js';
import { createSession, hashPassword, revokeAllSessions, revokeRefresh, rotateRefresh, signAccess, verifyPassword } from '../lib/auth.js';
import { conflict, unauthorized } from '../lib/errors.js';
import { isBanned, me, requireUser } from '../lib/guards.js';
import { officialMessage } from '../lib/notify.js';
import { toPublicUser, type Row } from '../lib/mappers.js';

const WELCOME = "Bienvenue sur PepsGoal ! Ce compte officiel t'envoie les nouveautés de l'app et les messages de la modération. Il ne lit pas les réponses.";
const strict = { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } };
const device = (ua: unknown) => String(ua ?? '').slice(0, 120);

export async function sessionPayload(u: Row, ua: unknown) {
  return {
    user: { ...toPublicUser(u), bio: u.bio, settings: u.settings, freezes: u.freezes, banned: isBanned({ banUntil: u.ban_until, banPermanent: u.ban_permanent }), warned: !!u.warned_at },
    ...(await createSession({ id: u.id, role: u.role }, device(ua)))
  };
}

export default async function authRoutes(app: FastifyInstance) {
  app.post('/v1/auth/register', strict, async (req, reply) => {
    const body = RegisterBody.parse(req.body);
    const [taken] = await sql`select 1 from users where username = ${body.username}`;
    if (taken) throw conflict("Ce nom d'utilisateur est déjà pris.", 'username_taken');
    const hash = await hashPassword(body.password);
    const u = await sql.begin(async tx => {
      const [row] = await tx<Row[]>`insert into users (username, display_name, password_hash) values (${body.username}, ${body.displayName}, ${hash}) returning *`;
      await officialMessage(tx, row!.id, WELCOME, 'info', true);
      const news = await tx<{ text: string }[]>`select text from announcements where tag = 'news' and for_new_users order by created_at desc limit 3`;
      for (const n of news.reverse()) await officialMessage(tx, row!.id, n.text, 'news', true);
      return row!;
    });
    reply.status(201);
    return sessionPayload(u, req.headers['user-agent']);
  });

  app.post('/v1/auth/login', strict, async req => {
    const body = LoginBody.parse(req.body);
    const [u] = await sql<Row[]>`select * from users where username = ${body.username.trim().toLowerCase()} and deleted_at is null`;
    const ok = await verifyPassword(body.password, u?.password_hash);
    if (!u || !ok || u.role === 'official') throw unauthorized("Nom d'utilisateur ou mot de passe incorrect.");
    return sessionPayload(u, req.headers['user-agent']);
  });

  app.post('/v1/auth/refresh', strict, async req => {
    const { refreshToken } = z.object({ refreshToken: z.string().min(20).max(200) }).parse(req.body);
    const r = await rotateRefresh(refreshToken, device(req.headers['user-agent']));
    const [u] = await sql<Row[]>`select id, role from users where id = ${r.userId} and deleted_at is null`;
    if (!u) throw unauthorized();
    return { accessToken: signAccess({ id: u.id, role: u.role }), refreshToken: r.refreshToken, expiresIn: 900 };
  });

  app.post('/v1/auth/logout', async req => {
    const { refreshToken } = z.object({ refreshToken: z.string().max(200) }).parse(req.body);
    await revokeRefresh(refreshToken);
    return { ok: true };
  });

  app.post('/v1/auth/password', { preHandler: requireUser, ...strict }, async req => {
    const body = z.object({ current: z.string().max(200), next: Password }).parse(req.body);
    const [u] = await sql<Row[]>`select * from users where id = ${me(req).id}`;
    if (!(await verifyPassword(body.current, u?.password_hash))) throw unauthorized('Le mot de passe actuel est incorrect.');
    await sql`update users set password_hash = ${await hashPassword(body.next)} where id = ${u!.id}`;
    await revokeAllSessions(u!.id);
    return sessionPayload(u!, req.headers['user-agent']);
  });
}
