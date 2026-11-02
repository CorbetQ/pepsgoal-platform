/**
 * Objectifs partagés (binôme, membres d'un défi de groupe ou d'un duel) : retrait d'accès.
 * Chaque retrait est noté dans goal_revocations : la synchronisation le transmet comme une suppression, pour que
 * l'appareil de la personne retire sa copie de l'objectif, même s'il était hors ligne au moment du retrait.
 */
import type { Tx } from '../db/client.js';

const nextRev = (tx: Tx) => tx`nextval('sync_rev_seq')`;

/** Retire l'accès de ces comptes à l'objectif (à appeler une fois le lien binôme ou membre supprimé). */
export async function revokeGoalAccess(tx: Tx, goalId: string, userIds: string[]): Promise<void> {
  for (const uid of new Set(userIds)) {
    await tx`insert into goal_revocations (user_id, goal_id, rev) values (${uid}, ${goalId}, ${nextRev(tx)})
      on conflict (user_id, goal_id) do update set rev = excluded.rev, created_at = now()`;
  }
}

/** Accès rendu (binôme ou membre ajouté de nouveau) : l'ancien retrait ne doit plus effacer l'objectif. */
export async function restoreGoalAccess(tx: Tx, goalId: string, userIds: string[]): Promise<void> {
  if (userIds.length) await tx`delete from goal_revocations where goal_id = ${goalId} and user_id = any(${userIds})`;
}

/** Binôme retiré d'un objectif. Ses validations en attente le restent : seul un nouveau binôme pourra les confirmer. */
export async function dropBuddy(tx: Tx, goalId: string, buddyId: string): Promise<void> {
  await revokeGoalAccess(tx, goalId, [buddyId]);
}

/**
 * Blocage entre deux comptes : chacun perd aussitôt l'accès aux objectifs de l'autre (binôme et membre). Les
 * objectifs d'un tiers où les deux sont membres restent partagés avec ce tiers.
 */
export async function revokeSharesBetween(tx: Tx, a: string, b: string): Promise<void> {
  for (const [owner, other] of [[a, b], [b, a]] as const) {
    const buddied = await tx<{ id: string }[]>`update goals set buddy_id = null, buddy_verify = false, buddy_miss = false, updated_at = now(), rev = ${nextRev(tx)}
      where owner_id = ${owner} and buddy_id = ${other} returning id`;
    for (const g of buddied) await dropBuddy(tx, g.id, other);
    const left = await tx<{ goal_id: string }[]>`delete from goal_members m using goals g
      where m.goal_id = g.id and g.owner_id = ${owner} and m.user_id = ${other} returning m.goal_id`;
    for (const g of left) {
      await tx`update goals set updated_at = now(), rev = ${nextRev(tx)} where id = ${g.goal_id}`;
      await revokeGoalAccess(tx, g.goal_id, [other]);
    }
  }
}
