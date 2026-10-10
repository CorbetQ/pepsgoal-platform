import { useColorScheme } from 'react-native';

// Mêmes couleurs que le prototype web (apps/web-legacy/pepsgoal.html)
const light = { bg: '#ECEEFF', card: 'rgba(255,255,255,0.78)', ink: '#0D0E2B', ink2: '#34375F', ink3: '#575A86', line: 'rgba(13,14,43,0.13)', danger: '#C8102E' };
const dark = { bg: '#07081A', card: 'rgba(28,30,76,0.85)', ink: '#F4F5FF', ink2: '#C9CCF2', ink3: '#9C9FD0', line: 'rgba(255,255,255,0.13)', danger: '#FF6B81' };
export const accent = { flame: '#FF4A12', flame2: '#FFB000', pink: '#FF3D96', onAccent: '#10102A' };
export const typeColor: Record<string, string> = {
  routine: '#B6FF2E', objective: '#22D3FF', deadline: '#FF4FA3', abstinence: '#A98BFF', monthly: '#FFD23F', limit: '#FF8A3D', duration: '#2EF2B0',
  measure: '#FF7AD9', timed: '#E3B98A', project: '#4D9BFF', challenge: '#FFB000', program: '#7C8CFF', group: '#7CFF6B', duel: '#FF5A5A'
};

export type Theme = typeof light;
export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}
