import { describe, expect, it } from 'vitest';
import { addDays, bestStreak, globalStreak, parseGoalData, resolveLww, ymd } from './index.js';

describe('séries', () => {
  const now = new Date(2026, 9, 10, 12);
  const day = (n: number) => ymd(addDays(now, -n));

  it('compte les jours consécutifs, aujourd’hui en attente ne casse pas la série', () => {
    expect(globalStreak(new Set([day(1), day(2), day(3)]), new Set(), now)).toEqual({ n: 3, lit: false });
    expect(globalStreak(new Set([day(0), day(1)]), new Set(), now)).toEqual({ n: 2, lit: true });
  });

  it('un gel comble un jour manqué', () => {
    expect(globalStreak(new Set([day(1), day(3)]), new Set([day(2)]), now).n).toBe(3);
  });

  it('calcule la meilleure série', () => {
    expect(bestStreak(['2026-10-01', '2026-10-02', '2026-10-04', '2026-10-05', '2026-10-06'])).toBe(3);
  });
});

describe('conflits', () => {
  const t = Date.parse('2026-10-10T10:00:00Z');
  it('la version la plus récente gagne', () => {
    expect(resolveLww('2026-10-10T09:00:00.000Z', '2026-10-10T09:30:00.000Z', t).accept).toBe(true);
    expect(resolveLww('2026-10-10T09:45:00.000Z', '2026-10-10T09:30:00.000Z', t).accept).toBe(false);
  });
  it('une horloge en avance est ramenée à maintenant + 5 min', () => {
    const r = resolveLww(null, '2030-01-01T00:00:00.000Z', t);
    expect(Date.parse(r.effectiveUpdatedAt)).toBe(t + 5 * 60_000);
  });
});

describe('validation des objectifs', () => {
  it('accepte une routine valide et refuse une heure invalide', () => {
    expect(parseGoalData('routine', { mode: 'days', days: [0, 2, 4], perWeek: 3 })).toBeTruthy();
    expect(() => parseGoalData('timed', { mode: 'before', time: '25:00', days: [0] })).toThrow();
  });
});
