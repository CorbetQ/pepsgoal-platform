// Assemble le site vitrine pepsgoal.fr : chaque page de pages/ reçoit l'en-tête et le pied de page communs (partials/),
// puis est écrite dans deploy/site/, servi tel quel par Caddy. Usage : node deploy/site-src/build.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dsBlocks } from './ds-gen.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '..', 'site');
const head = readFileSync(path.join(here, 'partials', 'head.html'), 'utf8');
const foot = readFileSync(path.join(here, 'partials', 'foot.html'), 'utf8');
// Blocs générés depuis les tokens du design system (page design-system.html)
const gen = dsBlocks(path.join(here, 'tokens.json'), path.join(out, 'assets', 'icons.svg'));
const fill = src => src.replace(/<!--GEN:(\w+)-->|\/\*GEN:(\w+)\*\//g, (m, a, b) => { const k = a || b; if (!(k in gen)) throw new Error(`Bloc inconnu : ${k}`); return gen[k]; });
const attr = (meta, k) => (meta.match(new RegExp(`${k}="([^"]*)"`)) || [])[1] || '';

for (const file of readdirSync(path.join(here, 'pages')).filter(f => f.endsWith('.html'))) {
  const src = fill(readFileSync(path.join(here, 'pages', file), 'utf8'));
  const meta = (src.match(/^<!--meta (.*?)-->\n/) || [])[1];
  if (!meta) throw new Error(`${file} : ligne <!--meta …--> manquante`);
  const title = attr(meta, 'title'), description = attr(meta, 'description'), nav = attr(meta, 'nav');
  const header = head.replace(new RegExp(`data-nav="${nav}"`, 'g'), `data-nav="${nav}" aria-current="page"`);
  const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${description}">
<meta name="theme-color" content="#07081A" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#ECEEFF" media="(prefers-color-scheme: light)">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:type" content="website">
<meta property="og:locale" content="fr_FR">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="preload" href="fonts/unbounded-latin-800.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="fonts/manrope-latin-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="assets/site.css">
<script>document.documentElement.classList.add('js');try{var t=localStorage.getItem('pepsgoal.site.theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}</script>
</head>
<body>
${header}
<main id="main">
${src.slice(src.indexOf('\n') + 1).trim()}
</main>
${foot}</body>
</html>
`;
  writeFileSync(path.join(out, file), html);
  console.log(`${file} (${(html.length / 1024).toFixed(1)} Ko)`);
}
