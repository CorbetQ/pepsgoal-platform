import { addDays, today, weekdayIndex, ymd, type Checkin, type Goal } from '@pepsgoal/shared';

/** Niveaux de flammes : mêmes paliers que l'app web. */
export const LEVELS: [number, string][] = [[0, 'Étincelle'], [100, 'Braise'], [300, 'Flamme'], [700, 'Brasier'], [1500, 'Incendie'], [3000, 'Supernova']];
export function level(pts: number) {
  let i = 0;
  while (i < LEVELS.length - 1 && pts >= LEVELS[i + 1]![0]) i++;
  const cur = LEVELS[i]!, nxt = LEVELS[i + 1];
  return { idx: i + 1, name: cur[1], pts, next: nxt ? nxt[0] : null, nextName: nxt ? nxt[1] : null, pct: nxt ? (pts - cur[0]) / (nxt[0] - cur[0]) : 1 };
}

export const WD = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
export const WD_LONG = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const WD_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

/** Réussite (et non rechute / consommation) : compte pour la série. */
export const isWin = (c: Checkin) => c.kind !== 'relapse' && c.kind !== 'use' && !c.pending;

/** Objectif à valider aujourd'hui : fonctionne entièrement hors ligne. */
export function dueToday(g: Goal): boolean {
  if (g.archived || g.completedAt || g.failedAt) return false;
  const d = g.data as Record<string, any>;
  if (g.type === 'routine') return d.mode === 'days' ? (d.days as number[]).includes(weekdayIndex(new Date())) : true;
  return ['abstinence', 'limit', 'duration', 'timed', 'challenge'].includes(g.type);
}
export const isOngoing = (g: Goal) => !g.archived && !g.completedAt && !g.failedAt && !dueToday(g) && g.type !== 'routine' && g.type !== 'abstinence';

const fmtDay = (k: string) => new Date(`${k}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
const daysBetween = (a: string, b: string) => Math.round((new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime()) / 86400000);

/** Ligne d'information sous le titre (« Lun · Mer · Ven », « Depuis le 8 octobre · 3 jours sans »…). */
export function metaLine(g: Goal): string {
  const d = g.data as Record<string, any>;
  switch (g.type) {
    case 'routine':
      return d.mode === 'days' ? ((d.days as number[]).length === 7 ? 'Tous les jours' : [...(d.days as number[])].sort().map(i => WD_SHORT[i]).join(' · ')) : `${d.perWeek} fois par semaine`;
    case 'abstinence': {
      const n = Math.max(0, daysBetween(d.since ?? today(), today()));
      return `Depuis le ${fmtDay(d.since ?? today())} · ${n} ${n > 1 ? 'jours' : 'jour'} sans`;
    }
    case 'deadline': {
      const n = daysBetween(today(), d.due ?? today());
      return n < 0 ? 'Échéance dépassée' : n === 0 ? "À rendre aujourd'hui" : `Échéance le ${fmtDay(d.due)} · J-${n}`;
    }
    case 'objective': case 'monthly': return `Cible : ${d.target ?? '?'} ${d.unit ?? ''}`.trim();
    default: return '';
  }
}

/** Semaine en cours (lundi → dimanche) : flamme allumée, à venir ou éteinte. */
export function weekDays(active: Set<string>) {
  const now = new Date(), ws = addDays(now, -weekdayIndex(now)), t = today();
  return Array.from({ length: 7 }, (_, i) => { const k = ymd(addDays(ws, i)); return { k, on: active.has(k), fut: k > t, today: k === t, label: WD[i]!, long: WD_LONG[i]! }; });
}
