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
  const token = randomBytes(48).toString('base64url');
  await sql`insert into refresh_tokens (user_id, token_hash, device, expires_at)
            values (${userId}, ${sha256(token)}, ${device.slice(0, 120)}, ${new Date(Date.now() + REFRESH_TTL_MS).toISOString()})`;
  return token;
}

export async function rotateRefresh(token: string, device: string): Promise<{ userId: string; refreshToken: string }> {
  const [row] = await sql<{ id: string; user_id: string; expires_at: Date; revoked_at: Date | null }[]>`
    select id, user_id, expires_at, revoked_at from refresh_tokens where token_hash = ${sha256(token)}`;
  if (!row || new Date(row.expires_at).getTime() < Date.now()) throw unauthorized('Session expirée, reconnecte-toi.');
  if (row.revoked_at) {
    // Réutilisation d'un jeton déjà échangé : possible vol, on révoque toutes les sessions du compte
    await sql`update refresh_tokens set revoked_at = now() where user_id = ${row.user_id} and revoked_at is null`;
    throw unauthorized('Session révoquée par sécurité, reconnecte-toi.');
  }
  await sql`update refresh_tokens set revoked_at = now() where id = ${row.id}`;
  return { userId: row.user_id, refreshToken: await issueRefresh(row.user_id, device) };
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
