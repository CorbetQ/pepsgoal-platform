import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DisplayName } from '@pepsgoal/shared';
import { sql } from '../db/client.js';
import { revokeAllSessions, verifyPassword } from '../lib/auth.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { isBanned, me, requireUser } from '../lib/guards.js';
import { iso, toCheckin, toGoal, toPublicUser, type Row } from '../lib/mappers.js';
import { env } from '../env.js';

const Avatar = z.object({
  kind: z.enum(['initials', 'photo', 'emoji', 'picto']),
  color: z.number().int().min(0).max(31),
  emoji: z.string().max(16).default(''),
  picto: z.string().max(20).default('flame'),
  // Seules les images téléversées sur ce serveur sont acceptées
  photoUrl: z.string().url().refine(u => u.startsWith(`${env.PUBLIC_URL}/media/`), 'Image non autorisée').nullable().default(null)
});

export default async function meRoutes(app: FastifyInstance) {
  app.get('/v1/me', { preHandler: requireUser }, async req => {
    const [u] = await sql<Row[]>`select * from users where id = ${me(req).id}`;
    const [appeal] = await sql<Row[]>`select status, answer, created_at from appeals where user_id = ${u!.id} order by created_at desc limit 1`;
    return {
      ...toPublicUser(u!), bio: u!.bio, settings: u!.settings, freezes: u!.freezes, createdAt: iso(u!.created_at),
      moderation: {
        banned: isBanned({ banUntil: u!.ban_until, banPermanent: u!.ban_permanent }), banUntil: iso(u!.ban_until), banPermanent: u!.ban_permanent, banReason: u!.ban_reason,
        warned: !!u!.warned_at, commentsRestricted: u!.comments_restricted,
        lastAppeal: appeal ? { status: appeal.status, answer: appeal.answer, createdAt: iso(appeal.created_at) } : null
      }
    };
  });

  app.patch('/v1/me', { preHandler: requireUser }, async req => {
    const body = z.object({ displayName: DisplayName.optional(), bio: z.string().max(160).optional(), avatar: Avatar.optional() }).parse(req.body);
    const id = me(req).id;
    if (body.displayName) await sql`update users set display_name = ${body.displayName} where id = ${id}`;
    if (body.bio !== undefined) await sql`update users set bio = ${body.bio} where id = ${id}`;
    if (body.avatar) await sql`update users set avatar = ${sql.json(body.avatar)} where id = ${id}`;
    return { ok: true };
  });

  /** Suppression définitive du compte (RGPD, exigence App Store / Play Store). */
  app.delete('/v1/me', { preHandler: requireUser, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async req => {
    const { password } = z.object({ password: z.string().max(200) }).parse(req.body);
    const u = me(req);
    if (u.role === 'admin') throw forbidden('Un compte administrateur ne peut pas se supprimer lui-même.');
    const [row] = await sql<Row[]>`select password_hash from users where id = ${u.id}`;
    if (!(await verifyPassword(password, row?.password_hash))) throw unauthorized('Mot de passe incorrect.');
    await revokeAllSessions(u.id);
    await sql`delete from users where id = ${u.id}`;
    return { ok: true };
  });

  /** Portabilité : toutes les données du compte en JSON. */
  app.get('/v1/me/export', { preHandler: requireUser, config: { rateLimit: { max: 3, timeWindow: '1 minute' } } }, async req => {
    const id = me(req).id;
    const [u] = await sql<Row[]>`select username, display_name, bio, avatar, settings, freezes, created_at from users where id = ${id}`;
    const goals = await sql<Row[]>`select * from goals where owner_id = ${id} and deleted_at is null`;
    const checkins = await sql<Row[]>`select * from checkins where user_id = ${id} and deleted_at is null`;
    const posts = await sql<Row[]>`select id, text, visibility, created_at from posts where author_id = ${id} and deleted_at is null`;
    const messages = await sql<Row[]>`select sender_id, recipient_id, text, created_at from messages where sender_id = ${id} or recipient_id = ${id}`;
    return { exportedAt: new Date().toISOString(), profile: u, goals: goals.map(toGoal), checkins: checkins.map(toCheckin), posts, messages };
  });
}
