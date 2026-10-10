import * as Crypto from 'expo-crypto';
import { POINTS, parseGoalData, today, type Checkin, type Goal, type GoalType, type SyncEntity, type UserSettings } from '@pepsgoal/shared';
import { store } from './local';

/**
 * Toutes les écritures passent par ici : on écrit d'abord dans la base locale (l'interface réagit tout de suite,
 * même hors ligne), puis on ajoute l'opération dans la file d'attente qui sera envoyée au serveur.
 */
const nowIso = () => new Date().toISOString();
export const newId = () => Crypto.randomUUID();

async function queue(entity: SyncEntity, action: 'upsert' | 'delete', id: string, data?: Record<string, unknown>) {
  await store.enqueue({ opId: newId(), entity, action, id, data, clientUpdatedAt: nowIso() });
}

export async function createGoal(ownerId: string, input: { type: GoalType; title: string; icon: string; data: Record<string, unknown>; visibility?: Goal['visibility']; groupId?: string | null }): Promise<Goal> {
  const at = nowIso();
  const goal: Goal = {
    id: newId(), ownerId, type: input.type, title: input.title.trim().slice(0, 80), icon: input.icon, note: '',
    visibility: input.visibility ?? 'friends', groupId: input.groupId ?? null, archived: false, completedAt: null, failedAt: null,
    data: parseGoalData(input.type, input.data), memberIds: [], buddyId: null, buddyVerify: false, buddyMiss: false, createdAt: at, updatedAt: at
  };
  await store.putGoal(goal);
  await queue('goal', 'upsert', goal.id, goal);
  return goal;
}

export async function updateGoal(goal: Goal, patch: Partial<Goal>): Promise<Goal> {
  const next = { ...goal, ...patch, updatedAt: nowIso() };
  await store.putGoal(next);
  await queue('goal', 'upsert', next.id, next);
  return next;
}

export async function deleteGoal(id: string): Promise<void> {
  await store.removeGoal(id);
  await queue('goal', 'delete', id);
}

/** Valide (ou annule) un objectif pour une date donnée. */
export async function toggleDone(goal: Goal, userId: string, date = today()): Promise<boolean> {
  const existing = (await store.checkins(date)).find(c => c.goalId === goal.id && c.date === date && c.kind === 'done' && c.userId === userId);
  if (existing) {
    await store.removeCheckin(existing.id);
    await queue('checkin', 'delete', existing.id);
    return false;
  }
  const at = nowIso();
  const c: Checkin = { id: newId(), goalId: goal.id, userId, date, kind: 'done', value: 1, points: POINTS[goal.type], pending: false, taskId: null, createdAt: at, updatedAt: at };
  await store.putCheckin(c);
  await queue('checkin', 'upsert', c.id, c);
  return true;
}

export async function saveSettings(s: UserSettings): Promise<void> {
  const next = { ...s, updatedAt: nowIso() };
  await store.putSettings(next);
  await queue('settings', 'upsert', 'settings', next);
}
