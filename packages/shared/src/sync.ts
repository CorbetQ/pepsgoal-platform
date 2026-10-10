import { z } from 'zod';
import { CheckinSchema, GoalGroupSchema, GoalSchema, IsoDate, UserSettingsSchema } from './schemas.js';

/**
 * Protocole de synchronisation hors ligne d'abord.
 *
 * - L'application écrit toujours dans sa base locale, puis ajoute une « opération » dans sa file d'attente (outbox).
 * - En ligne, elle envoie la file (`POST /v1/sync/push`) puis récupère les changements (`GET /v1/sync/pull?cursor=`).
 * - Chaque opération porte un identifiant unique : la renvoyer après une coupure ne crée jamais de doublon.
 * - Conflits : la modification la plus récente gagne (last-write-wins sur `updatedAt`).
 */
export const SyncEntity = z.enum(['goal', 'checkin', 'goalGroup', 'settings']);
export type SyncEntity = z.infer<typeof SyncEntity>;

export const SyncOp = z.object({
  opId: z.string().uuid(),
  entity: SyncEntity,
  action: z.enum(['upsert', 'delete']),
  id: z.string().min(1).max(64),
  data: z.record(z.unknown()).optional(),
  clientUpdatedAt: IsoDate
});
export type SyncOp = z.infer<typeof SyncOp>;

export const PushRequest = z.object({
  deviceId: z.string().min(1).max(64),
  ops: z.array(SyncOp).max(500)
});
export type PushRequest = z.infer<typeof PushRequest>;

export const RejectReason = z.enum(['stale', 'forbidden', 'invalid', 'not_found']);
export type RejectReason = z.infer<typeof RejectReason>;

export interface PushResponse {
  applied: string[];
  rejected: { opId: string; reason: RejectReason; message?: string }[];
  serverTime: string;
}

export const PullQuery = z.object({ cursor: z.coerce.number().int().min(0).default(0) });

export interface PullResponse {
  cursor: number;
  hasMore: boolean;
  goals: z.infer<typeof GoalSchema>[];
  checkins: z.infer<typeof CheckinSchema>[];
  goalGroups: z.infer<typeof GoalGroupSchema>[];
  settings: z.infer<typeof UserSettingsSchema> | null;
  deleted: { entity: SyncEntity; id: string }[];
}

/** Statut public renvoyé par `GET /v1/status` : l'app l'interroge pour savoir si le serveur est joignable. */
export interface ServerStatus {
  ok: true;
  serverTime: string;
  maintenance: { mode: 'social' | 'full'; endsAt: string | null; message: string } | null;
  minAppVersion: string;
}

/**
 * Règle de résolution des conflits, partagée par le serveur et l'app :
 * la version entrante gagne si elle est au moins aussi récente que la version existante.
 * Les dates trop dans le futur (horloge d'appareil déréglée) sont ramenées à « maintenant + 5 min ».
 */
export function resolveLww(existingUpdatedAt: string | null, incomingUpdatedAt: string, now = Date.now()): { accept: boolean; effectiveUpdatedAt: string } {
  const capped = Math.min(Date.parse(incomingUpdatedAt), now + 5 * 60_000);
  const effectiveUpdatedAt = new Date(capped).toISOString();
  if (existingUpdatedAt == null) return { accept: true, effectiveUpdatedAt };
  return { accept: capped >= Date.parse(existingUpdatedAt), effectiveUpdatedAt };
}
