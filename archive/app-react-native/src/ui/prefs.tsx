import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';
import { secure } from '../lib/secure';

/** Options d'accessibilité, propres à l'appareil (conservées après déconnexion). */
export interface A11yPrefs {
  /** Couleurs pleines noir/blanc, bordures marquées. */
  highContrast: boolean;
  /** Palette lisible avec les daltonismes courants (Okabe-Ito). */
  colorblind: boolean;
  /** Aucune animation de transition (en plus du réglage « Réduire les animations » du système). */
  reduceMotion: boolean;
  /** Cartes et fonds opaques, sans effet de transparence. */
  noTransparency: boolean;
}
const DEFAULTS: A11yPrefs = { highContrast: false, colorblind: false, reduceMotion: false, noTransparency: false };
const KEY = 'pg.a11y';

interface A11yState { prefs: A11yPrefs; set(patch: Partial<A11yPrefs>): void; motionReduced: boolean }
const Ctx = createContext<A11yState>({ prefs: DEFAULTS, set: () => {}, motionReduced: false });
export const useA11y = () => useContext(Ctx);

export function A11yProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<A11yPrefs>(DEFAULTS);
  const [systemReduce, setSystemReduce] = useState(false);

  useEffect(() => {
    void secure.get(KEY).then(v => { if (v) { try { setPrefs({ ...DEFAULTS, ...JSON.parse(v) }); } catch { /* préférences illisibles : valeurs par défaut */ } } });
    void AccessibilityInfo.isReduceMotionEnabled().then(setSystemReduce).catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setSystemReduce);
    return () => sub.remove();
  }, []);

  const set = useCallback((patch: Partial<A11yPrefs>) => {
    setPrefs(prev => { const next = { ...prev, ...patch }; void secure.set(KEY, JSON.stringify(next)); return next; });
  }, []);

  const value = useMemo(() => ({ prefs, set, motionReduced: prefs.reduceMotion || systemReduce }), [prefs, set, systemReduce]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
