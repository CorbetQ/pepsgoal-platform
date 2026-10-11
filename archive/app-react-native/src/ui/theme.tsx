import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { UserSettingsSchema, type GoalType, type UserSettings } from '@pepsgoal/shared';
import { store } from '../db/local';
import { saveSettings } from '../db/repo';
import { useSession } from '../state/session';
import { useA11y } from './prefs';

/**
 * Thème PepsGoal : mêmes couleurs, accents et règles que l'app web (apps/web-legacy/pepsgoal.html).
 * Fond nuit ou lavande, halos colorés, panneaux vitrés, accent en dégradé choisi par l'utilisateur.
 */

/** Couleurs d'accent : toutes assez claires pour porter du texte encre foncé (contraste AA). */
export const ACCENTS: { n: string; c: [string, string, string] }[] = [
  { n: 'Braise', c: ['#FFB000', '#FF4A12', '#FF3D96'] },
  { n: 'Lagon', c: ['#6FF7FF', '#22D3FF', '#4D9BFF'] },
  { n: 'Citron néon', c: ['#F4FF5C', '#B6FF2E', '#3DFF8A'] },
  { n: 'Fuchsia', c: ['#FFA6D9', '#FF4FA3', '#E85BFF'] },
  { n: 'Lavande', c: ['#DCCBFF', '#A98BFF', '#FF7AD9'] },
  { n: 'Menthe', c: ['#A8FFE4', '#2EF2B0', '#22D3FF'] },
  { n: 'Soleil', c: ['#FFE45C', '#FFB000', '#FF7A3D'] },
  { n: 'Corail', c: ['#FFC2A8', '#FF7B6B', '#FF4F8B'] },
  { n: 'Océan', c: ['#8AF0FF', '#3DB2FF', '#8C7DFF'] },
  { n: 'Cerise', c: ['#FF9A9A', '#FF3B5C', '#FF5ACD'] },
  { n: 'Aurore', c: ['#FFD1A1', '#FF8FB1', '#B98CFF'] },
  { n: 'Glacier', c: ['#E4F4FF', '#9FD8FF', '#B6B4FF'] }
];

const LIGHT = {
  bg: '#ECEEFF', blobs: ['#FF8A3D', '#FF3D96', '#2BC8FF', '#C6FF3D'], blobOpacity: 0.55,
  ink: '#0D0E2B', ink2: '#34375F', ink3: '#575A86',
  glass: 'rgba(255,255,255,0.58)', glassStrong: 'rgba(255,255,255,0.86)', glassEdge: 'rgba(255,255,255,0.95)', glassCard: 'rgba(255,255,255,0.7)',
  line: 'rgba(13,14,43,0.13)', track: 'rgba(13,14,43,0.10)', scrim: 'rgba(13,14,43,0.38)', shadow: 'rgba(40,24,110,0.32)',
  ok: '#1E8E3E', danger: '#C8102E', focus: '#0057D9'
};
const DARK: typeof LIGHT = {
  bg: '#07081A', blobs: ['#FF8A3D', '#FF3D96', '#2BC8FF', '#C6FF3D'], blobOpacity: 0.42,
  ink: '#F4F5FF', ink2: '#C9CCF2', ink3: '#9C9FD0',
  glass: 'rgba(24,26,66,0.55)', glassStrong: 'rgba(28,30,76,0.9)', glassEdge: 'rgba(255,255,255,0.14)', glassCard: 'rgba(24,26,66,0.72)',
  line: 'rgba(255,255,255,0.13)', track: 'rgba(255,255,255,0.10)', scrim: 'rgba(3,3,14,0.62)', shadow: 'rgba(0,0,0,0.7)',
  ok: '#5BE38A', danger: '#FF6B81', focus: '#6FE3FF'
};

/** Couleur de chaque type d'objectif : teinte vive + encre lisible (clair / sombre). */
const TYPE: Record<GoalType, [string, string, string]> = {
  objective: ['#22D3FF', '#00627E', '#5FE0FF'], deadline: ['#FF4FA3', '#B0005A', '#FF7DBB'], routine: ['#B6FF2E', '#3A7300', '#C6FF5C'],
  abstinence: ['#A98BFF', '#5530CF', '#BFA8FF'], monthly: ['#FFD23F', '#7A4E00', '#FFE07A'], limit: ['#FF8A3D', '#A33D00', '#FFB07A'],
  duration: ['#2EF2B0', '#00704F', '#5FF5C4'], project: ['#4D9BFF', '#0B4FC2', '#8CBDFF'], measure: ['#FF7AD9', '#A3007A', '#FF9FE4'],
  group: ['#7CFF6B', '#1F7A10', '#9DFF90'], duel: ['#FF5A5A', '#B3121F', '#FF8A8A'], challenge: ['#FFB000', '#8A5300', '#FFC94D'],
  program: ['#7C8CFF', '#2F3FBF', '#A9B3FF'], timed: ['#E3B98A', '#7A4B12', '#F0CFA6']
};
/** Mode daltonien : palette Okabe-Ito (deutéranopie, protanopie, tritanopie). */
const TYPE_CVD: Record<GoalType, [string, string, string]> = {
  objective: ['#E69F00', '#8A5A00', '#FFC24D'], deadline: ['#D55E00', '#A04400', '#FF8A4D'], routine: ['#56B4E9', '#0B5E8F', '#8FD0F5'],
  abstinence: ['#CC79A7', '#8E3F6B', '#E7A6CB'], monthly: ['#F0E442', '#6E6400', '#F5EC6E'], limit: ['#F5B94D', '#8A5300', '#FFD08A'],
  duration: ['#009E73', '#006B4E', '#3FD9AE'], project: ['#0072B2', '#005080', '#6CB6E8'], measure: ['#E3A6C8', '#8E3F6B', '#F0C2DB'],
  group: ['#2BBF95', '#006B4E', '#5FE0B8'], duel: ['#F08C4A', '#9A4A10', '#FFB07A'], challenge: ['#F7EE7F', '#6E6400', '#FAF29A'],
  program: ['#9AD0F0', '#0B5E8F', '#B7E0F7'], timed: ['#BBBBBB', '#4D4D4D', '#DDDDDD']
};

export const TYPE_LABEL: Record<GoalType, string> = {
  objective: 'Objectif', deadline: 'Deadline', routine: 'Routine', abstinence: 'Abstinence', monthly: 'Mensuel', limit: 'Limite',
  duration: 'Durée', measure: 'Mesure', timed: 'Horaire', project: 'Projet', challenge: 'Challenge', program: 'Paliers', group: 'Défi de groupe', duel: 'Duel'
};
export const TYPE_ICON: Record<GoalType, string> = {
  objective: 'target', deadline: 'cal', routine: 'repeat', abstinence: 'ban', monthly: 'month', limit: 'gauge', duration: 'timer',
  measure: 'trend', timed: 'clock', project: 'list', challenge: 'trophy', program: 'stairs', group: 'group', duel: 'duel'
};

/** Polices : Unbounded pour les titres et chiffres, Manrope pour le texte (chargées dans app/_layout.tsx). */
export const FONT = {
  display: 'Unbounded_800ExtraBold', displayBold: 'Unbounded_700Bold',
  body: 'Manrope_500Medium', semibold: 'Manrope_600SemiBold', bold: 'Manrope_700Bold', heavy: 'Manrope_800ExtraBold'
};

export interface Theme extends Omit<typeof LIGHT, 'blobs'> {
  dark: boolean;
  blobs: string[];
  /** Dégradé d'accent [clair, principal, rose] et texte posé dessus. */
  accent: [string, string, string];
  flame: string;
  onAccent: string;
  borderWidth: number;
  highContrast: boolean;
  /** Compatibilité avec les écrans existants. */
  card: string;
  type(t: GoalType | string): { c: string; ink: string };
}

interface AppearanceState { theme: Theme; settings: UserSettings; setAppearance(patch: Partial<Pick<UserSettings, 'theme' | 'accent'>>): Promise<void> }
const Ctx = createContext<AppearanceState | null>(null);

function build(dark: boolean, accentIdx: number, a11y: ReturnType<typeof useA11y>['prefs']): Theme {
  let base = { ...(dark ? DARK : LIGHT) };
  if (a11y.noTransparency) base = { ...base, glass: dark ? '#1C1E4C' : '#FFFFFF', glassStrong: dark ? '#1C1E4C' : '#FFFFFF', glassCard: dark ? '#1C1E4C' : '#FFFFFF', glassEdge: dark ? '#33366B' : '#C9CBE0', blobOpacity: 0 };
  if (a11y.highContrast) base = dark
    ? { ...base, bg: '#000000', ink: '#FFFFFF', ink2: '#FFFFFF', ink3: '#E8E8E8', glass: '#000000', glassStrong: '#000000', glassCard: '#000000', glassEdge: '#FFFFFF', line: '#FFFFFF', track: 'rgba(255,255,255,0.35)', blobOpacity: 0, focus: '#FFD400' }
    : { ...base, bg: '#FFFFFF', ink: '#000000', ink2: '#000000', ink3: '#1F1F1F', glass: '#FFFFFF', glassStrong: '#FFFFFF', glassCard: '#FFFFFF', glassEdge: '#000000', line: '#000000', track: 'rgba(0,0,0,0.3)', blobOpacity: 0, focus: '#0040C0' };
  if (a11y.colorblind) base = { ...base, ok: dark ? '#56B4E9' : '#0072B2', danger: dark ? '#FF8A4D' : '#D55E00' };
  const acc = (ACCENTS[accentIdx] ?? ACCENTS[0]!).c;
  const pal = a11y.colorblind ? TYPE_CVD : TYPE;
  return {
    ...base, dark, accent: acc, flame: acc[1], onAccent: '#10102A', borderWidth: a11y.highContrast ? 2 : 1, highContrast: a11y.highContrast,
    card: base.glassCard,
    type: t => { const v = pal[t as GoalType] ?? pal.routine; return { c: v[0], ink: dark ? v[2] : v[1] }; }
  };
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const { prefs } = useA11y();
  const { dataVersion, mode } = useSession();
  const [settings, setSettings] = useState<UserSettings>(() => UserSettingsSchema.parse({}));

  useEffect(() => { if (mode !== 'loading') void store.settings().then(s => setSettings(s ?? UserSettingsSchema.parse({}))).catch(() => undefined); }, [dataVersion, mode]);

  const setAppearance = useCallback(async (patch: Partial<Pick<UserSettings, 'theme' | 'accent'>>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    if (mode === 'account' || mode === 'guest') await saveSettings(next);
  }, [settings, mode]);

  const dark = settings.theme === 'system' ? system === 'dark' : settings.theme === 'dark';
  const theme = useMemo(() => build(dark, settings.accent, prefs), [dark, settings.accent, prefs]);
  const value = useMemo(() => ({ theme, settings, setAppearance }), [theme, settings, setAppearance]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const FALLBACK = build(true, 0, { highContrast: false, colorblind: false, reduceMotion: false, noTransparency: false });
export function useTheme(): Theme { return useContext(Ctx)?.theme ?? FALLBACK; }
export function useAppearance() {
  const c = useContext(Ctx);
  if (!c) throw new Error('AppearanceProvider manquant');
  return c;
}
/** Couleur d'un type d'objectif (palette normale ou daltonienne). */
export function useTypeColor(): Record<string, string> {
  const t = useTheme();
  return new Proxy({}, { get: (_, k: string) => t.type(k).c }) as Record<string, string>;
}
/** Teinte translucide d'une couleur hexadécimale (équivalent de color-mix du web). */
export function alpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(x => x + x).join('') : h.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
/** Compatibilité : accent par défaut, pour les rares usages hors thème. */
export const accent = { flame: '#FF4A12', flame2: '#FFB000', pink: '#FF3D96', onAccent: '#10102A' };
