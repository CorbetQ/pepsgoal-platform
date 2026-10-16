// Assemble le site vitrine pepsgoal.fr : chaque page de pages/ reçoit l'en-tête et le pied de page communs (partials/),
// puis est écrite dans deploy/site/, servi tel quel par Caddy. Usage : node deploy/site-src/build.mjs
import { readFileSync, writeFileSync, readdirSync, existsSync, copyFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dsBlocks } from './ds-gen.mjs';
import { buildIcons } from './icons.mjs';
import { emojiPicker } from './emoji-gen.mjs';
import { changelogBlocks } from './changelog-gen.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '..', 'site');
const head = readFileSync(path.join(here, 'partials', 'head.html'), 'utf8');
const foot = readFileSync(path.join(here, 'partials', 'foot.html'), 'utf8');
const appPath = path.join(here, '..', '..', 'apps', 'web-legacy', 'pepsgoal.html');
const app = readFileSync(appPath, 'utf8');
// Icônes : celles de l'application, plus celles propres au site
const icons = buildIcons(app, path.join(here, 'icons-extra.svg'), path.join(out, 'assets', 'icons.svg'));
// Blocs générés : tokens du design system (page design-system.html), échantillon du sélecteur d'emojis
const gen = {
  ...dsBlocks(path.join(here, 'tokens.json'), icons.app),
  ...emojiPicker(app, path.join(here, '..', '..', 'apps', 'web', 'emoji'), path.join(out, 'emoji')),
  ...changelogBlocks(path.join(here, '..', '..', 'CHANGELOG.md'))
};
// Emojis Fluent cités par les pages (emoji/<code>.webp) : copiés depuis l'application s'ils manquent
const emojiSrc = path.join(here, '..', '..', 'apps', 'web', 'emoji');
const copyEmojis = html => { for (const [, f] of html.matchAll(/emoji\/([0-9a-f-]+\.webp)/g)) { const to = path.join(out, 'emoji', f); if (existsSync(to)) continue; const from = path.join(emojiSrc, f); if (!existsSync(from)) throw new Error(`Emoji introuvable : ${f}`); copyFileSync(from, to); } };
// Numéro de version de l'application ({{VERSION}} dans les pages)
const APP_VERSION = (app.match(/const APP_VERSION = '([^']+)'/) || [])[1];
if (!APP_VERSION) throw new Error('APP_VERSION introuvable dans pepsgoal.html');
// Documents légaux : mêmes textes que dans l'application (constante LEGAL de apps/web-legacy/pepsgoal.html)
const LEGAL = (() => {
  const a = app.indexOf('const LEGAL_MAIL = '), b = app.indexOf('\n};\n', app.indexOf('const LEGAL = {', a));
  if (a < 0 || b < 0) throw new Error('Textes légaux introuvables dans pepsgoal.html');
  const ctx = { APP_VERSION };
  vm.runInNewContext(app.slice(a, b + 3) + '\nthis.LEGAL = LEGAL; this.LEGAL_UPDATED = LEGAL_UPDATED;', ctx);
  return { docs: ctx.LEGAL, updated: ctx.LEGAL_UPDATED };
})();
const fill = src => src.replace(/\{\{VERSION\}\}/g, APP_VERSION).replace(/\{\{LEGAL_UPDATED\}\}/g, LEGAL.updated).replace(/<!--GEN:(\w+)-->|\/\*GEN:(\w+)\*\//g, (m, a, b) => { const k = a || b; if (!(k in gen)) throw new Error(`Bloc inconnu : ${k}`); return gen[k]; });
const LEGAL_PAGES = [['cgu', 'cgu', 'Conditions d’utilisation'], ['mentions', 'mentions-legales', 'Mentions légales'], ['privacy', 'confidentialite', 'Confidentialité'], ['license', 'licence', 'Licence MIT']];
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
// Typographie française sur le texte affiché (hors code, styles et scripts) : espaces insécables devant : ; ! ?
// et dans les guillemets, entre un nombre et son unité, séparateur des milliers, apostrophe typographique
const NBSP = ' ', NNBSP = ' ';
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const UNITS = 'h|min|s|ms|jours?|heures|minutes|ans|Mo|Ko|km|px|octets|itérations|livres|requêtes|routes|chiffres|flammes|validations|amis|membres|commentaires|séances|cafés|pages|pas|%';
function frTypo(text) {
  return text
    .replace(/(\p{L})'(\p{L})/gu, '$1’$2')
    .replace(/« /g, `«${NBSP}`).replace(/ »/g, `${NBSP}»`)
    .replace(/(\S|^) ([!?;])(?=\s|$)/g, `$1${NNBSP}$2`)
    .replace(/(\S|^) :(?=\s|$)/g, `$1${NBSP}:`)
    .replace(/(\d) (?=\d{3}(?!\d))/g, `$1${NNBSP}`)
    .replace(new RegExp(`(\\d) (${UNITS})(?![\\p{L}\\d])`, 'gu'), `$1${NBSP}$2`);
}
function typography(html) {
  const stack = [];
  return html.replace(/<!--[\s\S]*?-->|<\/?([a-zA-Z][\w-]*)[^>]*>|[^<]+/g, (tok, tag) => {
    if (tok.startsWith('<!--')) return tok;
    if (tag) {
      const name = tag.toLowerCase();
      if (tok.startsWith('</')) { const i = stack.lastIndexOf(stack.findLast(e => e.name === name)); if (i >= 0) stack.length = i; return tok; }
      if (VOID.has(name) || tok.endsWith('/>')) return tok;
      const parentSkip = stack.length ? stack[stack.length - 1].skip : false;
      const skip = parentSkip || ['script', 'style', 'code', 'pre', 'textarea'].includes(name) || /\bclass="[^"]*\b(code|tree|cipher-band|safety)\b/.test(tok);
      stack.push({ name, skip });
      return tok;
    }
    return stack.length && stack[stack.length - 1].skip ? tok : frTypo(tok);
  });
}
// Empreinte de chaque fichier commun, ajoutée à son adresse (?v=…) : une mise à jour du site force le navigateur
// à recharger la feuille de style, le script et les icônes au lieu de garder une ancienne version en cache
const VERSIONED = ['site.css', 'site.js', 'icons.svg'];
const version = Object.fromEntries(VERSIONED.map(f => [f, createHash('sha256').update(readFileSync(path.join(out, 'assets', f))).digest('hex').slice(0, 10)]));
const withVersions = html => html.replace(/assets\/(site\.css|site\.js|icons\.svg)(?=["#])/g, (m, f) => `assets/${f}?v=${version[f]}`);
const attr = (meta, k) => (meta.match(new RegExp(`${k}="([^"]*)"`)) || [])[1] || '';

const sources = [
  ...readdirSync(path.join(here, 'pages')).filter(f => f.endsWith('.html')).map(f => [f, fill(readFileSync(path.join(here, 'pages', f), 'utf8'))]),
  ...LEGAL_PAGES.map(([key, slug]) => [`${slug}.html`, legalSource(key)])
];
for (const [file, src] of sources) {
  const meta = (src.match(/^<!--meta (.*?)-->\n/) || [])[1];
  if (!meta) throw new Error(`${file} : ligne <!--meta …--> manquante`);
  const title = attr(meta, 'title'), description = attr(meta, 'description'), nav = attr(meta, 'nav');
  const header = fill(head).replace(new RegExp(`data-nav="${nav}"`, 'g'), `data-nav="${nav}" aria-current="page"`);
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
<script>document.documentElement.classList.add('js');try{var t=localStorage.getItem('pepsgoal.site.theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;var b=localStorage.getItem('pepsgoal.site.bg');if(b)document.documentElement.dataset.bg=b}catch(e){}</script>
</head>
<body>
${header}
<main id="main">
${src.slice(src.indexOf('\n') + 1).trim()}
</main>
${fill(foot)}</body>
</html>
`;
  const page = withVersions(typography(html));
  copyEmojis(page);
  // La page 404 peut s'afficher à n'importe quelle adresse : ses liens partent de la racine du site
  writeFileSync(path.join(out, file), file === '404.html' ? page.replace(/(href|src)="(?!https?:|mailto:|#|\/)/g, '$1="/') : page);
  console.log(`${file} (${(html.length / 1024).toFixed(1)} Ko)`);
}
