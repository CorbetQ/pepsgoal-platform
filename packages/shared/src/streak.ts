import { addDays, ymd, type DayKey } from './dates.js';

/**
 * Série globale : nombre de jours consécutifs avec au moins une validation (ou protégés par un gel).
 * Aujourd'hui sans validation ne casse pas la série : on compte alors à partir d'hier.
 */
export function globalStreak(activeDays: Set<DayKey>, frozenDays: Set<DayKey> = new Set(), now = new Date()): { n: number; lit: boolean } {
  const ok = (k: DayKey) => activeDays.has(k) || frozenDays.has(k);
  const lit = activeDays.has(ymd(now));
  let d = ok(ymd(now)) ? now : addDays(now, -1);
  let n = 0;
  for (let i = 0; i < 3650 && ok(ymd(d)); i++) { n++; d = addDays(d, -1); }
  return { n, lit };
}

/** Meilleure série sur un ensemble de jours. */
export function bestStreak(days: Iterable<DayKey>): number {
  const sorted = [...new Set(days)].sort();
  let best = 0, run = 0, prev: string | null = null;
  for (const d of sorted) {
    run = prev && ymd(addDays(new Date(`${prev}T12:00:00`), 1)) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}
