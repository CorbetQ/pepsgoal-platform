import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { sql } from '../db/client.js';
import { env } from '../env.js';
import { unauthorized } from './errors.js';

const ACCESS_TTL_S = 15 * 60;
const REFRESH_TTL_MS = 30 * 864e5;
// Empreinte factice : la vérification prend le même temps qu'un compte existe ou non
const DUMMY_HASH = bcrypt.hashSync('pepsgoal-dummy-password', 10);

export const hashPassword = (pw: string) => bcrypt.hash(pw, 12);
export async function verifyPassword(pw: string, hash: string | null | undefined): Promise<boolean> {
  const ok = await bcrypt.compare(pw, hash ?? DUMMY_HASH);
  return ok && !!hash;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function signAccess(user: { id: string; role: string }): string {
  return jwt.sign({ role: user.role }, env.JWT_SECRET, { subject: user.id, expiresIn: ACCESS_TTL_S, issuer: 'pepsgoal' });
}

export function verifyAccess(token: string): { sub: string } {
  const p = jwt.verify(token, env.JWT_SECRET, { issuer: 'pepsgoal' });
  if (typeof p === 'string' || !p.sub) throw unauthorized('Jeton invalide.');
  return { sub: p.sub };
}

/** Jeton de renouvellement : aléatoire, stocké uniquement sous forme d'empreinte, à usage unique (rotation). */
export async function issueRefresh(userId: string, device: string): Promise<string> {
  return (await issue(userId, device)).token;
}

async function issue(userId: string, device: string): Promise<{ token: string; id: string }> {
  const token = randomBytes(48).toString('base64url');
  const [row] = await sql<{ id: string }[]>`insert into refresh_tokens (user_id, token_hash, device, expires_at)
            values (${userId}, ${sha256(token)}, ${device.slice(0, 120)}, ${new Date(Date.now() + REFRESH_TTL_MS).toISOString()}) returning id`;
  return { token, id: row!.id };
}

/** Émet le successeur de [oldId] et garde le lien (rotation). */
async function succeed(oldId: string, userId: string, device: string): Promise<string> {
  const n = await issue(userId, device);
  await sql`update refresh_tokens set replaced_by = ${n.id} where id = ${oldId}`;
  return n.token;
}

export async function rotateRefresh(token: string, device: string): Promise<{ userId: string; refreshToken: string }> {
  const [row] = await sql<{ id: string; user_id: string; expires_at: Date; revoked_at: Date | null; replaced_by: string | null }[]>`
    select id, user_id, expires_at, revoked_at, replaced_by from refresh_tokens where token_hash = ${sha256(token)}`;
  if (!row || new Date(row.expires_at).getTime() < Date.now()) throw unauthorized('Session expirée, reconnecte-toi.');
  // Échange atomique : deux demandes simultanées avec le même jeton ne peuvent pas l'échanger toutes les deux
  const done = row.revoked_at ? [] : await sql`update refresh_tokens set revoked_at = now() where id = ${row.id} and revoked_at is null returning id`;
  if (done.length) return { userId: row.user_id, refreshToken: await succeed(row.id, row.user_id, device) };
  // Jeton déjà échangé, mais son successeur n'a jamais servi : la réponse s'est perdue en route (réseau coupé,
  // application fermée pendant l'échange) et l'appareil n'a jamais reçu son nouveau jeton. On remplace ce successeur
  // au lieu de déconnecter le compte.
  const freed = row.replaced_by ? await sql`update refresh_tokens set revoked_at = now() where id = ${row.replaced_by} and revoked_at is null returning id` : [];
  if (freed.length) return { userId: row.user_id, refreshToken: await succeed(row.id, row.user_id, device) };
  // Réutilisation d'un jeton dont le successeur a déjà servi : possible vol, on révoque toutes les sessions du compte
  await sql`update refresh_tokens set revoked_at = now() where user_id = ${row.user_id} and revoked_at is null`;
  throw unauthorized('Session révoquée par sécurité, reconnecte-toi.');
}

export async function revokeRefresh(token: string): Promise<void> {
  await sql`update refresh_tokens set revoked_at = now() where token_hash = ${sha256(token)} and revoked_at is null`;
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await sql`update refresh_tokens set revoked_at = now() where user_id = ${userId} and revoked_at is null`;
}

export async function createSession(user: { id: string; role: string }, device: string) {
  return { accessToken: signAccess(user), refreshToken: await issueRefresh(user.id, device), expiresIn: ACCESS_TTL_S };
}
