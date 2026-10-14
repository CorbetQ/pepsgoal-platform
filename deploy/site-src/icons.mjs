// Sprite d'icônes du site : toutes les icônes de l'application (constante P de apps/web-legacy/pepsgoal.html,
// même tracé au trait 24 px) plus celles propres au site (icons-extra.svg). Écrit dans deploy/site/assets/icons.svg.
import { readFileSync, writeFileSync } from 'node:fs';

export function buildIcons(appSource, extraPath, outPath) {
  const a = appSource.indexOf('const P = {'), b = appSource.indexOf('\n};', a);
  if (a < 0 || b < 0) throw new Error('Icônes introuvables dans pepsgoal.html (const P)');
  const P = Function(`return ${appSource.slice(a + 10, b + 2)}`)();
  const extra = readFileSync(extraPath, 'utf8').replace(/<!--[\s\S]*?-->\n?/g, '').trim();
  const own = new Set([...extra.matchAll(/<symbol id="([^"]+)"/g)].map(m => m[1]));
  const app = Object.entries(P).filter(([k]) => !own.has(k)).map(([k, v]) => `<symbol id="${k}" viewBox="0 0 24 24">${v}</symbol>`);
  writeFileSync(outPath, `<svg xmlns="http://www.w3.org/2000/svg">\n${app.join('\n')}\n${extra}\n</svg>\n`);
  return { app: Object.keys(P), own: [...own] };
}
