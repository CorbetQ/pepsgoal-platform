import { useColorScheme } from 'react-native';
import { useA11y } from './prefs';

// Mêmes couleurs que le prototype web (apps/web-legacy/pepsgoal.html)
const light = { bg: '#ECEEFF', card: 'rgba(255,255,255,0.78)', ink: '#0D0E2B', ink2: '#34375F', ink3: '#575A86', line: 'rgba(13,14,43,0.13)', danger: '#C8102E' };
const dark = { bg: '#07081A', card: 'rgba(28,30,76,0.85)', ink: '#F4F5FF', ink2: '#C9CCF2', ink3: '#9C9FD0', line: 'rgba(255,255,255,0.13)', danger: '#FF6B81' };
// Sans transparence : mêmes teintes, opaques
const lightOpaque = { ...light, card: '#FFFFFF', line: '#C9CBE0' };
const darkOpaque = { ...dark, card: '#1C1E4C', line: '#33366B' };
// Contraste élevé : noir et blanc purs (rapport 21:1), bordures pleines
const lightHigh = { bg: '#FFFFFF', card: '#FFFFFF', ink: '#000000', ink2: '#000000', ink3: '#1F1F1F', line: '#000000', danger: '#A0001C' };
const darkHigh = { bg: '#000000', card: '#000000', ink: '#FFFFFF', ink2: '#FFFFFF', ink3: '#E8E8E8', line: '#FFFFFF', danger: '#FF9AA8' };

export const accent = { flame: '#FF4A12', flame2: '#FFB000', pink: '#FF3D96', onAccent: '#10102A' };
export const typeColor: Record<string, string> = {
  routine: '#B6FF2E', objective: '#22D3FF', deadline: '#FF4FA3', abstinence: '#A98BFF', monthly: '#FFD23F', limit: '#FF8A3D', duration: '#2EF2B0',
  measure: '#FF7AD9', timed: '#E3B98A', project: '#4D9BFF', challenge: '#FFB000', program: '#7C8CFF', group: '#7CFF6B', duel: '#FF5A5A'
};
/**
 * Mode daltonien : palette Okabe-Ito (distinguable avec deutéranopie, protanopie et tritanopie),
 * en teintes claires pour garder un bon contraste avec le texte foncé posé dessus. Le type reste aussi écrit en toutes lettres.
 */
export const typeColorCvd: Record<string, string> = {
  routine: '#56B4E9', objective: '#E69F00', deadline: '#F0E442', abstinence: '#CC79A7', monthly: '#9AD0F0', limit: '#F5B94D', duration: '#2BBF95',
  measure: '#E3A6C8', timed: '#D9D9D9', project: '#5AA9E6', challenge: '#F7EE7F', program: '#B9B9B9', group: '#3FCF9F', duel: '#F08C4A'
};

export type Theme = typeof light & { borderWidth: number };
export function useTheme(): Theme {
  const darkMode = useColorScheme() === 'dark';
  const { prefs } = useA11y();
  const base = prefs.highContrast ? (darkMode ? darkHigh : lightHigh)
    : prefs.noTransparency ? (darkMode ? darkOpaque : lightOpaque)
    : (darkMode ? dark : light);
  return { ...base, borderWidth: prefs.highContrast ? 2 : 1 };
}
export function useTypeColor(): Record<string, string> {
  return useA11y().prefs.colorblind ? typeColorCvd : typeColor;
}
