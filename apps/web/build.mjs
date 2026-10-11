#!/usr/bin/env node
/**
 * Construit la version publiée de PepsGoal à partir de l'application d'origine (apps/web-legacy/pepsgoal.html),
 * sans toucher à son interface :
 *   - en-tête HTML complet (encodage, écran mobile, icônes, manifeste) ;
 *   - configuration (adresse de l'API) et couche connectée (src/cloud.js) ;
 *   - bibliothèques intégrées : tweetnacl (chiffrement des messages) et JSZip (export .zip), sans CDN ;
 *   - polices Unbounded et Manrope servies localement (fonctionnent hors ligne).
 *
 * Sorties :
 *   apps/web/dist/                         version web (https://app.pepsgoal.fr), polices en fichiers séparés
 *   apps/app/src/webapp.generated.ts       version mobile : un seul fichier HTML (polices intégrées), embarqué dans l'app
 *
 * Usage : node apps/web/build.mjs        (API : variable PEPSGOAL_API, https://api.pepsgoal.fr par défaut)
 */
import { createRequire } from 'node:module';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const require = createRequire(import.meta.url);
const API = (process.env.PEPSGOAL_API || 'https://api.pepsgoal.fr').replace(/\/$/, '');
const VERSION = JSON.parse(readFileSync(path.join(root, 'apps/app/app.json'), 'utf8')).expo.version;

const source = readFileSync(path.join(root, 'apps/web-legacy/pepsgoal.html'), 'utf8').replace(/\r\n/g, '\n');
const cloud = readFileSync(path.join(here, 'src/cloud.js'), 'utf8');
const nacl = readFileSync(require.resolve('tweetnacl/nacl-fast.min.js'), 'utf8');
const jszip = readFileSync(require.resolve('jszip/dist/jszip.min.js'), 'utf8');

// Polices (Fontsource) : mêmes graisses que celles demandées à Google Fonts par l'application
const FONTS = [['unbounded', 'Unbounded', [500, 700, 800]], ['manrope', 'Manrope', [400, 500, 600, 700, 800]]];
const SUBSETS = [
  ['latin', 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'],
  ['latin-ext', 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF']
];
function fontFiles() {
  const out = [];
  for (const [pkg, family, weights] of FONTS) {
    const dir = path.join(path.dirname(require.resolve(`@fontsource/${pkg}/package.json`)), 'files');
    for (const w of weights) for (const [subset, range] of SUBSETS) {
      const file = path.join(dir, `${pkg}-${subset}-${w}-normal.woff2`);
      if (existsSync(file)) out.push({ family, weight: w, range, file, name: `${pkg}-${subset}-${w}.woff2` });
    }
  }
  return out;
}
const fontCss = (fonts, url) => fonts.map(f => `@font-face{font-family:"${f.family}";font-style:normal;font-weight:${f.weight};font-display:swap;src:url(${url(f)}) format("woff2");unicode-range:${f.range}}`).join('\n');

function page({ platform, fonts, fontUrl }) {
  // Les polices Google sont remplacées par les fichiers locaux ; JSZip est déjà chargé (loadJSZip le trouve tout de suite)
  let body = source.replace(/<link rel="preconnect"[^>]*>\n?/g, '').replace(/<link href="https:\/\/fonts\.googleapis\.com[^>]*>\n?/, '');
  const main = body.indexOf('<script>\n"use strict";');
  if (main < 0) throw new Error('Script principal introuvable dans pepsgoal.html');
  const config = { api: API, platform, version: VERSION };
  const inject = `<script>window.PEPSGOAL_CONFIG=${JSON.stringify(config)};</script>\n<script>${nacl}</script>\n<script>${jszip}</script>\n<script>${cloud}</script>\n`;
  body = body.slice(0, main) + inject + body.slice(main);
  const head = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#07081A">
<meta name="description" content="PepsGoal : fixe tes objectifs, valide chaque jour et garde ta flamme allumée.">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
${platform === 'web' ? '<link rel="manifest" href="/manifest.webmanifest">\n<link rel="icon" href="/favicon.png">\n<link rel="apple-touch-icon" href="/icon-512.png">\n' : ''}<style>
${fontCss(fonts, fontUrl)}
</style>
`;
  return head + body + (body.trimEnd().endsWith('</html>') ? '' : '\n</body>\n</html>\n');
}

const fonts = fontFiles();
if (fonts.length < 8) throw new Error('Polices introuvables : lance « npm install » à la racine.');

// ---------- version web ----------
const dist = path.join(here, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(path.join(dist, 'fonts'), { recursive: true });
for (const f of fonts) copyFileSync(f.file, path.join(dist, 'fonts', f.name));
writeFileSync(path.join(dist, 'index.html'), page({ platform: 'web', fonts, fontUrl: f => `/fonts/${f.name}` }));
copyFileSync(path.join(here, 'public/.htaccess'), path.join(dist, '.htaccess'));
copyFileSync(path.join(root, 'apps/app/assets/icon.png'), path.join(dist, 'icon-512.png'));
copyFileSync(path.join(root, 'apps/app/assets/favicon.png'), path.join(dist, 'favicon.png'));
writeFileSync(path.join(dist, 'manifest.webmanifest'), JSON.stringify({
  name: 'PepsGoal', short_name: 'PepsGoal', lang: 'fr', start_url: '/', display: 'standalone',
  background_color: '#07081A', theme_color: '#07081A', icons: [{ src: '/icon-512.png', sizes: '1024x1024', type: 'image/png', purpose: 'any' }]
}, null, 2));

// ---------- version mobile : un seul fichier, polices intégrées ----------
const embedded = page({ platform: 'app', fonts, fontUrl: f => `data:font/woff2;base64,${readFileSync(f.file).toString('base64')}` });
writeFileSync(path.join(root, 'apps/app/src/webapp.generated.ts'),
  `// Fichier généré par apps/web/build.mjs à partir de apps/web-legacy/pepsgoal.html : ne pas modifier à la main.\n` +
  `export const WEBAPP_VERSION = ${JSON.stringify(VERSION)};\nexport const WEBAPP_API = ${JSON.stringify(API)};\n` +
  `const html: string = ${JSON.stringify(embedded)};\nexport default html;\n`);

const kb = n => `${Math.round(n / 1024)} Ko`;
console.log(`PepsGoal ${VERSION} (API ${API})`);
console.log(`  web    : apps/web/dist/index.html (${kb(readFileSync(path.join(dist, 'index.html')).length)}) + ${fonts.length} polices`);
console.log(`  mobile : apps/app/src/webapp.generated.ts (${kb(embedded.length)})`);
