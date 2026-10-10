import type { FastifyRequest } from 'fastify';
import { sql } from '../db/client.js';
import { verifyAccess } from './auth.js';
import { forbidden, HttpError, unauthorized } from './errors.js';
import { currentMaintenance } from './maintenance.js';

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: 'user' | 'admin' | 'official';
  banUntil: Date | null;
  banPermanent: boolean;
  warnedAt: Date | null;
  commentsRestricted: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthUser;
  }
}

export const isBanned = (u: Pick<AuthUser, 'banUntil' | 'banPermanent'>) => !!u.banPermanent || (u.banUntil != null && new Date(u.banUntil).getTime() > Date.now());

/** Exige un jeton d'accès valide. Pendant une maintenance complète, seuls les admins passent. */
export async function requireUser(req: FastifyRequest): Promise<void> {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) throw unauthorized();
  let sub: string;
  try { sub = verifyAccess(h.slice(7)).sub; } catch { throw unauthorized('Session expirée.'); }
  const [u] = await sql<AuthUser[]>`
    select id, username, display_name as "displayName", role, ban_until as "banUntil", ban_permanent as "banPermanent",
           warned_at as "warnedAt", comments_restricted as "commentsRestricted"
    from users where id = ${sub} and deleted_at is null`;
  if (!u) throw unauthorized('Compte introuvable.');
  if (u.role === 'official') throw forbidden('Ce compte ne peut pas se connecter.');
  if (u.role !== 'admin') {
    const m = await currentMaintenance();
    if (m?.mode === 'full') throw new HttpError(503, 'maintenance', m.message || 'PepsGoal est en maintenance, réessaie plus tard.');
  }
  req.auth = u;
}

export function me(req: FastifyRequest): AuthUser {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

export async function requireAdmin(req: FastifyRequest): Promise<void> {
  await requireUser(req);
  if (me(req).role !== 'admin') throw forbidden('Réservé à la modération.');
}

/** Actions sociales en écriture : refusées aux comptes bannis et pendant une maintenance sociale. */
export async function requireSocial(req: FastifyRequest): Promise<void> {
  await requireUser(req);
  const u = me(req);
  if (u.role === 'admin') return;
  if (isBanned(u)) throw forbidden('Ton accès à la plateforme sociale est suspendu.', 'banned');
  const m = await currentMaintenance();
  if (m) throw new HttpError(503, 'maintenance', 'Maintenance en cours : les fonctions sociales sont en lecture seule.');
}

/** Vrai si l'un des deux utilisateurs a bloqué l'autre. */
export async function isBlocked(a: string, b: string): Promise<boolean> {
  const [r] = await sql`select 1 from blocks where (blocker_id = ${a} and blocked_id = ${b}) or (blocker_id = ${b} and blocked_id = ${a}) limit 1`;
  return !!r;
}

export async function areFriends(a: string, b: string): Promise<boolean> {
  const [r] = await sql`select 1 from friendships where status = 'accepted'
    and ((requester_id = ${a} and addressee_id = ${b}) or (requester_id = ${b} and addressee_id = ${a})) limit 1`;
  return !!r;
}
