// Assemble le site vitrine pepsgoal.fr : chaque page de pages/ reçoit l'en-tête et le pied de page communs (partials/),
// puis est écrite dans deploy/site/, servi tel quel par Caddy. Usage : node deploy/site-src/build.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
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
// Documents légaux : mêmes textes que dans l'application (constante LEGAL de apps/web-legacy/pepsgoal.html)
const app = readFileSync(path.join(here, '..', '..', 'apps', 'web-legacy', 'pepsgoal.html'), 'utf8');
const LEGAL = (() => {
  const a = app.indexOf('const LEGAL_MAIL = '), b = app.indexOf('\n};\n', app.indexOf('const LEGAL = {', a));
  if (a < 0 || b < 0) throw new Error('Textes légaux introuvables dans pepsgoal.html');
  const ctx = { APP_VERSION: (app.match(/const APP_VERSION = '([^']+)'/) || [])[1] };
  vm.runInNewContext(app.slice(a, b + 3) + '\nthis.LEGAL = LEGAL; this.LEGAL_UPDATED = LEGAL_UPDATED;', ctx);
  return { docs: ctx.LEGAL, updated: ctx.LEGAL_UPDATED };
})();
const LEGAL_PAGES = [['cgu', 'cgu', 'Conditions d’utilisation'], ['mentions', 'mentions-legales', 'Mentions légales'], ['privacy', 'confidentialite', 'Confidentialité']];
function legalSource(key) {
  const d = LEGAL.docs[key], strip = h => h.replace(/<[^>]+>/g, '');
  const tabs = LEGAL_PAGES.map(([k, slug, label]) => `<a href="${slug}.html"${k === key ? ' class="on" aria-current="page"' : ''}>${label}</a>`).join('');
  return `<!--meta title="${d.title} · PepsGoal" description="${d.title} de PepsGoal, sur le web (app.pepsgoal.fr), iOS et Android." nav="informations-legales"-->
<section class="page-hero doc-hero">
  <div class="wrap">
    <span class="eyebrow rv">Informations légales</span>
    <h1 data-split>${d.title}</h1>
    <p class="lead rv" style="--d:2">Dernière mise à jour : ${LEGAL.updated}. Le même texte que dans l’application, rubrique Paramètres.</p>
    <nav class="doc-tabs glass rv" style="--d:3" aria-label="Documents légaux">${tabs}<a href="informations-legales.html">En résumé</a></nav>
  </div>
</section>
<div class="wrap doc">
  <nav class="doc-toc glass" aria-label="Sommaire">${d.sections.map(([t], i) => `<a href="#s${i + 1}">${strip(t)}</a>`).join('')}</nav>
  <article class="doc-body">
    ${d.sections.map(([t, html], i) => `<section class="card prose doc-sec" id="s${i + 1}"><h2>${t}</h2>${html}</section>`).join('\n    ')}
  </article>
</div>`;
}
const attr = (meta, k) => (meta.match(new RegExp(`${k}="([^"]*)"`)) || [])[1] || '';

const sources = [
  ...readdirSync(path.join(here, 'pages')).filter(f => f.endsWith('.html')).map(f => [f, fill(readFileSync(path.join(here, 'pages', f), 'utf8'))]),
  ...LEGAL_PAGES.map(([key, slug]) => [`${slug}.html`, legalSource(key)])
];
for (const [file, src] of sources) {
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
  // La page 404 peut s'afficher à n'importe quelle adresse : ses liens partent de la racine du site
  writeFileSync(path.join(out, file), file === '404.html' ? html.replace(/(href|src)="(?!https?:|mailto:|#|\/)/g, '$1="/') : html);
  console.log(`${file} (${(html.length / 1024).toFixed(1)} Ko)`);
}
