#!/usr/bin/env node
/**
 * Construit la version publiée de PepsGoal à partir de l'application d'origine (apps/web-legacy/pepsgoal.html),
 * sans toucher à son interface :
 *   - en-tête HTML complet (encodage, écran mobile, icônes, manifeste) ;
 *   - configuration (adresse de l'API) et couche connectée (src/cloud.js) ;
 *   - bibliothèques intégrées : tweetnacl (chiffrement des messages) et JSZip (export .zip), sans CDN ;
 *   - polices Unbounded et Manrope servies localement (fonctionnent hors ligne) ;
 *   - emojis Fluent de Microsoft (apps/web/emoji, générés par scripts/fluent-emoji.mjs), chargés à la demande.
 *
 * Sorties :
 *   apps/web/dist/                         version web (https://app.pepsgoal.fr), polices en fichiers séparés
 *   apps/web/dist/legal/                   CGU, mentions légales et confidentialité en pages autonomes (servies aussi sur https://pepsgoal.fr)
 *   apps/app/src/webapp.generated.ts       version mobile : un seul fichier HTML (polices intégrées), embarqué dans l'app
 *
 * Usage : node apps/web/build.mjs        (API : variable PEPSGOAL_API, https://api.pepsgoal.fr par défaut)
 */
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
// Emojis Fluent : liste des emojis disponibles (codes), les images restent des fichiers séparés
const EMOJI_DIR = path.join(here, 'emoji');
const emojiKeys = existsSync(path.join(EMOJI_DIR, 'index.json')) ? JSON.parse(readFileSync(path.join(EMOJI_DIR, 'index.json'), 'utf8')) : [];
// Application mobile : les images sont chargées depuis la version web (mises en cache par l'appareil)
const EMOJI_WEB = process.env.PEPSGOAL_APP_URL ? `${process.env.PEPSGOAL_APP_URL.replace(/\/$/, '')}/emoji/` : 'https://app.pepsgoal.fr/emoji/';

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
  if (emojiKeys.length) config.emoji = { base: platform === 'web' ? '/emoji/' : EMOJI_WEB };
  const inject = `<script>window.PEPSGOAL_CONFIG=${JSON.stringify(config)};window.PEPSGOAL_EMOJI=${JSON.stringify(emojiKeys)};</script>\n<script>${nacl}</script>\n<script>${jszip}</script>\n<script>${cloud}</script>\n`;
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
copyFileSync(path.join(here, 'public/sw.js'), path.join(dist, 'sw.js'));   // notifications push
if (emojiKeys.length) cpSync(EMOJI_DIR, path.join(dist, 'emoji'), { recursive: true, filter: f => !f.endsWith('index.json') });
copyFileSync(path.join(root, 'apps/app/assets/icon.png'), path.join(dist, 'icon-512.png'));
copyFileSync(path.join(root, 'apps/app/assets/favicon.png'), path.join(dist, 'favicon.png'));
writeFileSync(path.join(dist, 'manifest.webmanifest'), JSON.stringify({
  name: 'PepsGoal', short_name: 'PepsGoal', lang: 'fr', start_url: '/', display: 'standalone',
  background_color: '#07081A', theme_color: '#07081A', icons: [{ src: '/icon-512.png', sizes: '1024x1024', type: 'image/png', purpose: 'any' }]
}, null, 2));

// ---------- documents légaux : mêmes textes que dans l'application (constante LEGAL de pepsgoal.html) ----------
function legalDocs() {
  const a = source.indexOf('const LEGAL_MAIL = '), b = source.indexOf('\n};\n', source.indexOf('const LEGAL = {', a));
  if (a < 0 || b < 0) throw new Error('Textes légaux introuvables dans pepsgoal.html');
  const ctx = { APP_VERSION: VERSION };
  // LINKS (liens du projet) est défini juste avant LEGAL dans pepsgoal.html
  vm.runInNewContext(source.slice(a, b + 3) + '\nthis.LEGAL = LEGAL; this.LEGAL_UPDATED = LEGAL_UPDATED;', ctx);
  return { docs: ctx.LEGAL, updated: ctx.LEGAL_UPDATED };
}
const LEGAL_PAGES = [['cgu', 'cgu'], ['mentions', 'mentions-legales'], ['privacy', 'confidentialite'], ['license', 'licence']];
function legalPage(key, { docs, updated }) {
  const d = docs[key];
  const nav = LEGAL_PAGES.map(([k, slug]) => `<a href="/${slug}"${k === key ? ' aria-current="page"' : ''}>${docs[k].short}</a>`).join(' · ');
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${d.title} · PepsGoal</title>
<meta name="description" content="${d.title} de l’application PepsGoal.">
<style>
  :root{color-scheme:light dark;--bg:#F6F6FB;--ink:#14152E;--ink2:#4A4C6B;--line:#E2E3EE;--flame:#E8400C}
  @media (prefers-color-scheme:dark){:root{--bg:#07081A;--ink:#F4F5FF;--ink2:#C9CCF2;--line:#24264A;--flame:#FF6A3D}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:32px 16px 64px}
  main{max-width:760px;margin:0 auto}
  header a{color:var(--flame);font-weight:800;text-decoration:none;font-size:20px}
  h1{font-size:30px;line-height:1.2;margin:18px 0 4px}
  h2{font-size:19px;margin:28px 0 6px}
  p,li{color:var(--ink2)} b{color:var(--ink)}
  a{color:var(--flame)}
  nav{margin:12px 0 4px;font-size:14px}
  .maj{font-size:14px;color:var(--ink2);border-bottom:1px solid var(--line);padding-bottom:16px}
</style>
</head>
<body>
<main>
<header><a href="/">🔥 PepsGoal</a></header>
<nav>${nav}</nav>
<h1>${d.title}</h1>
<p class="maj">Dernière mise à jour : ${updated}</p>
${d.sections.map(([t, html]) => `<section><h2>${t}</h2>${html}</section>`).join('\n')}
</main>
</body>
</html>
`;
}
const legal = legalDocs();
mkdirSync(path.join(dist, 'legal'), { recursive: true });
for (const [key, slug] of LEGAL_PAGES) writeFileSync(path.join(dist, 'legal', `${slug}.html`), legalPage(key, legal));

// ---------- version mobile : un seul fichier, polices intégrées ----------
const embedded = page({ platform: 'app', fonts, fontUrl: f => `data:font/woff2;base64,${readFileSync(f.file).toString('base64')}` });
writeFileSync(path.join(root, 'apps/app/src/webapp.generated.ts'),
  `// Fichier généré par apps/web/build.mjs à partir de apps/web-legacy/pepsgoal.html : ne pas modifier à la main.\n` +
  `export const WEBAPP_VERSION = ${JSON.stringify(VERSION)};\nexport const WEBAPP_API = ${JSON.stringify(API)};\n` +
  `const html: string = ${JSON.stringify(embedded)};\nexport default html;\n`);

const kb = n => `${Math.round(n / 1024)} Ko`;
console.log(`PepsGoal ${VERSION} (API ${API})`);
console.log(`  web    : apps/web/dist/index.html (${kb(readFileSync(path.join(dist, 'index.html')).length)}) + ${fonts.length} polices + ${LEGAL_PAGES.length} pages légales + ${emojiKeys.length} emojis Fluent`);
console.log(`  mobile : apps/app/src/webapp.generated.ts (${kb(embedded.length)})`);
