import { describe, expect, it } from 'vitest';
import { CheckinSchema, GoalSchema, PushRequest, StoryBody } from '@pepsgoal/shared';

// Tests sans base de données : contrats d'entrée de l'API (les routes s'appuient sur ces schémas)
describe('contrats de l’API', () => {
  const now = new Date().toISOString();
  const uuid = '3f1c2b4a-8d7e-4f6a-9b0c-1d2e3f4a5b6c';

  it('accepte une file de synchronisation valide et refuse une opération inconnue', () => {
    expect(PushRequest.safeParse({ deviceId: 'iphone', ops: [{ opId: uuid, entity: 'goal', action: 'upsert', id: uuid, data: {}, clientUpdatedAt: now }] }).success).toBe(true);
    expect(PushRequest.safeParse({ deviceId: 'x', ops: [{ opId: uuid, entity: 'user', action: 'upsert', id: uuid, clientUpdatedAt: now }] }).success).toBe(false);
  });

  it('applique les valeurs par défaut d’un objectif', () => {
    const g = GoalSchema.parse({ id: uuid, ownerId: uuid, type: 'routine', title: ' Lire ', data: {}, createdAt: now, updatedAt: now });
    expect(g.title).toBe('Lire');
    expect(g.visibility).toBe('friends');
    expect(g.memberIds).toEqual([]);
  });

  it('refuse des points hors limites et une date mal formée', () => {
    const base = { id: uuid, goalId: uuid, userId: uuid, kind: 'done', value: 1, createdAt: now, updatedAt: now };
    expect(CheckinSchema.safeParse({ ...base, date: '2026-10-10', points: 9999 }).success).toBe(false);
    expect(CheckinSchema.safeParse({ ...base, date: '10/10/2026', points: 10 }).success).toBe(false);
  });

  it('refuse une story « progression » avec un pourcentage invalide', () => {
    const data = { type: 'routine', icon: '🏃', title: 'Courir', v: '12', l: 'jours', label: 'Routine', meta: '', pct: 2 };
    expect(StoryBody.safeParse({ kind: 'progress', data, text: '' }).success).toBe(false);
  });
});
