import { createHash, randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { sql, type Sql, type Tx } from '../db/client.js';
import { env } from '../env.js';
import { unauthorized } from './errors.js';

const ACCESS_TTL_S = 15 * 60;
const REFRESH_TTL_MS = 30 * 864e5;
/** Réponse de renouvellement perdue : l'ancien jeton peut resservir, une seule chaîne de session et sur le même appareil, pendant ce délai. */
const REPLAY_GRACE_MS = 2 * 60e3;
const BCRYPT_COST = 12;
// Empreinte factice, au même coût que les vraies : la vérification prend le même temps qu'un compte existe ou non
const DUMMY_HASH = bcrypt.hashSync('pepsgoal-dummy-password', BCRYPT_COST);

export const hashPassword = (pw: string) => bcrypt.hash(pw, BCRYPT_COST);
export async function verifyPassword(pw: string, hash: string | null | undefined): Promise<boolean> {
  const ok = await bcrypt.compare(pw, hash ?? DUMMY_HASH);
  return ok && !!hash;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Jeton d'accès : `sid` désigne la session (chaîne de jetons de renouvellement), vérifiée à chaque requête. */
export function signAccess(user: { id: string; role: string }, sid: string): string {
  return jwt.sign({ role: user.role, sid }, env.JWT_SECRET, { subject: user.id, expiresIn: ACCESS_TTL_S, issuer: 'pepsgoal' });
}

export function verifyAccess(token: string): { sub: string; sid: string | null } {
  const p = jwt.verify(token, env.JWT_SECRET, { issuer: 'pepsgoal' });
  if (typeof p === 'string' || !p.sub) throw unauthorized('Jeton invalide.');
  return { sub: p.sub, sid: typeof p.sid === 'string' ? p.sid : null };
}

/** Jeton de renouvellement : aléatoire, stocké uniquement sous forme d'empreinte, à usage unique (rotation). */
async function issue(tx: Sql | Tx, userId: string, device: string, familyId: string | null): Promise<{ token: string; id: string; familyId: string }> {
  const token = randomBytes(48).toString('base64url');
  // Première connexion : la session prend l'identifiant de son premier jeton
  const id = randomUUID(), family = familyId ?? id;
  await tx`insert into refresh_tokens (id, user_id, token_hash, device, expires_at, family_id)
            values (${id}, ${userId}, ${sha256(token)}, ${device.slice(0, 120)}, ${new Date(Date.now() + REFRESH_TTL_MS).toISOString()}, ${family})`;
  return { token, id, familyId: family };
}

interface RefreshRow { id: string; user_id: string; expires_at: Date; revoked_at: Date | null; replaced_by: string | null; device: string; family_id: string | null }

/**
 * Rotation du jeton de renouvellement, dans une transaction (le jeton présenté est verrouillé : deux demandes
 * simultanées sont traitées l'une après l'autre).
 * - Jeton actif : il est révoqué et remplacé par un successeur de la même session.
 * - Jeton déjà échangé dont le successeur n'a jamais servi (réponse perdue en route) : reprise acceptée seulement dans
 *   les 2 minutes qui suivent l'échange et depuis le même appareil ; le successeur inutilisé est remplacé.
 * - Toute autre réutilisation : possible vol. Successeur déjà utilisé : toutes les sessions du compte sont révoquées ;
 *   reprise trop tardive : la session est révoquée.
 */
export async function rotateRefresh(token: string, device: string): Promise<{ userId: string; refreshToken: string; sid: string }> {
  const r = await sql.begin(async tx => {
    const [row] = await tx<RefreshRow[]>`
      select id, user_id, expires_at, revoked_at, replaced_by, device, family_id from refresh_tokens where token_hash = ${sha256(token)} for update`;
    if (!row || new Date(row.expires_at).getTime() < Date.now()) return { error: 'expired' as const };
    const family = row.family_id ?? row.id;
    if (!row.revoked_at) {
      await tx`update refresh_tokens set revoked_at = now() where id = ${row.id}`;
      const n = await issue(tx, row.user_id, device, family);
      await tx`update refresh_tokens set replaced_by = ${n.id} where id = ${row.id}`;
      return { userId: row.user_id, refreshToken: n.token, sid: n.familyId };
    }
    const [next] = row.replaced_by ? await tx<RefreshRow[]>`
      select id, user_id, expires_at, revoked_at, replaced_by, device, family_id from refresh_tokens where id = ${row.replaced_by} for update` : [];
    const unused = next && !next.revoked_at;
    const recent = Date.now() - new Date(row.revoked_at).getTime() <= REPLAY_GRACE_MS;
    if (unused && recent && row.device === device.slice(0, 120)) {
      const n = await issue(tx, row.user_id, device, family);
      await tx`update refresh_tokens set revoked_at = now(), replaced_by = ${n.id} where id = ${next.id}`;
      await tx`update refresh_tokens set replaced_by = ${n.id} where id = ${row.id}`;
      return { userId: row.user_id, refreshToken: n.token, sid: n.familyId };
    }
    if (unused) {
      await tx`update refresh_tokens set revoked_at = now() where family_id = ${family} and revoked_at is null`;
      return { error: 'replay' as const };
    }
    await tx`update refresh_tokens set revoked_at = now() where user_id = ${row.user_id} and revoked_at is null`;
    return { error: 'reuse' as const };
  });
  if ('error' in r) throw unauthorized(r.error === 'expired' ? 'Session expirée, reconnecte-toi.' : 'Session révoquée par sécurité, reconnecte-toi.');
  return r;
}

/** Déconnexion : toute la session du jeton présenté (ses jetons d'accès sont refusés aussitôt). */
export async function revokeRefresh(token: string): Promise<void> {
  await sql`update refresh_tokens set revoked_at = now() where revoked_at is null
    and family_id = (select coalesce(family_id, id) from refresh_tokens where token_hash = ${sha256(token)})`;
}

/** Événement de sécurité (mot de passe changé, compte supprimé) : toutes les sessions, jetons d'accès compris. */
export async function revokeAllSessions(userId: string): Promise<void> {
  await sql`update refresh_tokens set revoked_at = now() where user_id = ${userId} and revoked_at is null`;
}

export async function createSession(user: { id: string; role: string }, device: string) {
  const n = await issue(sql, user.id, device, null);
  return { accessToken: signAccess(user, n.familyId), refreshToken: n.token, expiresIn: ACCESS_TTL_S };
}
