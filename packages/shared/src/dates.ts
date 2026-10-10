// Dates « jour » au format AAAA-MM-JJ, toujours exprimées dans le fuseau local de l'appareil.
const pad = (n: number) => String(n).padStart(2, '0');

export type DayKey = string;

export function ymd(d: Date | number | string): DayKey {
  const x = new Date(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}

export function parseYmd(s: DayKey): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** 0 = lundi … 6 = dimanche */
export function weekdayIndex(d: Date | DayKey): number {
  const x = typeof d === 'string' ? parseYmd(d) : d;
  return (x.getDay() + 6) % 7;
}

export function weekStart(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - weekdayIndex(x));
  return x;
}

export function today(): DayKey {
  return ymd(new Date());
}

export function daysBetween(a: DayKey, b: DayKey): number {
  return Math.round((parseYmd(b).getTime() - parseYmd(a).getTime()) / 864e5);
}
