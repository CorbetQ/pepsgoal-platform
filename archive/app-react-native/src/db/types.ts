import type { Checkin, Goal, GoalGroup, SyncOp, UserSettings } from '@pepsgoal/shared';

/**
 * Base locale de l'appareil : source de vérité de l'interface, y compris hors ligne.
 * Implémentée avec SQLite sur iOS / Android (local.ts) et le stockage du navigateur sur le web (local.web.ts).
 */
export interface LocalStore {
  init(): Promise<void>;
  goals(): Promise<Goal[]>;
  putGoal(g: Goal): Promise<void>;
  removeGoal(id: string): Promise<void>;
  checkins(fromDate?: string): Promise<Checkin[]>;
  putCheckin(c: Checkin): Promise<void>;
  removeCheckin(id: string): Promise<void>;
  groups(): Promise<GoalGroup[]>;
  putGroup(g: GoalGroup): Promise<void>;
  removeGroup(id: string): Promise<void>;
  settings(): Promise<UserSettings | null>;
  putSettings(s: UserSettings): Promise<void>;
  /** File d'attente des modifications à envoyer au serveur. */
  enqueue(op: SyncOp): Promise<void>;
  pending(limit: number): Promise<SyncOp[]>;
  ack(opIds: string[]): Promise<void>;
  pendingCount(): Promise<number>;
  meta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;
  /** Passage d'un profil sans compte à un compte : les données locales changent de propriétaire. */
  reassignOwner(fromId: string, toId: string): Promise<void>;
  wipe(): Promise<void>;
}
