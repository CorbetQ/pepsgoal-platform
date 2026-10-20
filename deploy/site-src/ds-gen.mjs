// Génère les blocs de la page Design system à partir de tokens.json (copie des tokens du design system PepsGoal).
// Chaque bloc remplace un repère <!--GEN:nom--> (ou /*GEN:nom*/ dans le CSS) de pages/design-system.html.
import { readFileSync } from 'node:fs';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// `code` du Markdown des tokens → <code>
const md = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');

export function dsBlocks(tokensPath, appIcons) {
  const T = JSON.parse(readFileSync(tokensPath, 'utf8'));
  const themes = T.color.themes.map(t => t.id);
  const color = Object.fromEntries(T.color.tokens.map(t => [t.name, t]));
  const val = (name, theme) => { const v = color[name].value; return typeof v === 'string' ? v : (v[theme] ?? v[themes[0]]); };

  const swatch = name => {
    const l = val(name, 'light'), d = val(name, 'dark');
    // une couleur translucide est montrée sur le fond de son thème
    const half = (v, bg) => { const c = over(v, val('bg', bg)); return `<span style="background:linear-gradient(${v},${v}),${val('bg', bg)};color:${rel(c) > .3 ? '#0D0E2B' : '#F4F5FF'}">${esc(short(v))}</span>`; };
    return `<button type="button" class="sw rv" data-copy="${name}" aria-label="Copier ${name}"><span class="sw-c">${half(l, 'light')}${half(d, 'dark')}</span><span class="sw-b"><b>${name}</b><small>${md(firstSentence(color[name].usage))}</small></span></button>`;
  };

  // contraste (WCAG) des encres sur bg
  const pairs = [['ink', 'Texte principal'], ['ink-2', 'Texte secondaire, labels'], ['ink-3', 'Méta, placeholders'], ['focus', 'Anneau de focus'], ['ok', 'Succès, avec icône'], ['danger', 'Erreur, avec mot ou icône']];
  const cell = (fg, bg) => { const r = ratio(hex(fg), hex(bg)); return `<td><b>${r.toFixed(1).replace('.', ',')}:1</b> ${r >= 4.5 ? '<span class="chip" style="--c:var(--ok);--c-ink:var(--ok)">AA</span>' : r >= 3 ? '<span class="chip" style="--c:var(--t-limit);--c-ink:var(--t-limit-ink)">≥19px gras</span>' : ''}</td>`; };
  const contrast = pairs.map(([n, u]) => `<tr><td><b>${n}</b> sur bg</td>${cell(val(n, 'light'), val('bg', 'light'))}${cell(val(n, 'dark'), val('bg', 'dark'))}<td>${u}</td></tr>`).join('');

  const TYPES = [['Objectif', 'objective', 'goal', 'target'], ['Deadline', 'deadline', 'deadline', 'cal'], ['Routine', 'routine', 'routine', 'repeat'], ['Abstinence', 'abstinence', 'abst', 'ban'], ['Mensuel', 'monthly', 'month', 'month'], ['Limite', 'limit', 'limit', 'gauge'], ['Durée', 'duration', 'dur', 'timer'], ['Mesure', 'measure', 'meas', 'trend'], ['Horaire', 'timed', 'timed', 'clock'], ['Projet', 'project', 'proj', 'list'], ['Challenge', 'challenge', 'chal', 'trophy'], ['Paliers', 'program', 'prog', 'stairs'], ['Défi de groupe', 'group', 'group', 'group'], ['Duel', 'duel', 'duel', 'duel'], ['Période', 'period', 'period', 'period']];
  const types = TYPES.map(([label, cls, tok, ic]) => `<tr class="t-${cls}"><td><span class="tdot"><svg class="i"><use href="assets/icons.svg#${ic}"/></svg><b>${label}</b></span></td><td><code>t-${cls}</code></td><td><span class="tdot"><i></i><code>${val(`t-${tok}`, 'light')}</code></span></td><td><code>${val(`t-${tok}-ink`, 'light')}</code> · <code>${val(`t-${tok}-ink`, 'dark')}</code></td><td><span class="chip t-${cls}"><svg class="i"><use href="assets/icons.svg#${ic}"/></svg>${label}</span></td></tr>`).join('');

  // CSS des thèmes pour l'aperçu, plus le thème OLED (2.1.0) : le sombre en noir pur, panneaux sombres et nets
  const blobOp = { light:.55, dark:.42, 'hc-light':0, 'hc-dark':0, 'cvd-light':.55, 'cvd-dark':.42, 'opaque-light':0, 'opaque-dark':0 };
  const OLED = { bg:'#000000', glass:'rgba(12,12,16,.78)', 'glass-strong':'#0B0B0F', 'glass-edge':'rgba(255,255,255,.1)', line:'rgba(255,255,255,.12)', scrim:'rgba(0,0,0,.78)' };
  const shadow = Object.fromEntries(T.shadow.tokens.map(t => [t.name, t.value]));
  const themecss = themes.map(th => `.tp[data-t="${th}"]{${T.color.tokens.map(t => `--${t.name}:${val(t.name, th)}`).join(';')};--shadow:${typeof shadow.shadow === 'string' ? shadow.shadow : shadow.shadow[th]};--blob-op:${blobOp[th]};color-scheme:${th.endsWith('dark') ? 'dark' : 'light'}}`).join('\n  ')
    + `\n  .tp[data-t="oled"]{${T.color.tokens.map(t => `--${t.name}:${OLED[t.name] ?? val(t.name, 'dark')}`).join(';')};--shadow:0 14px 40px -18px rgba(0,0,0,.9);--blob-op:.18;color-scheme:dark}`;

  const typeRow = s => `<div class="scale-row"><div class="meta"><b>${s.name}</b><small>${s.fontSize} · ${s.fontWeight}${s.letterSpacing ? ` · ${s.letterSpacing}` : ''}</small></div><div class="smp" style="font-family:var(--font-${s.family});font-size:${cl(s.fontSize)};line-height:${s.lineHeight};font-weight:${s.fontWeight};${s.letterSpacing ? `letter-spacing:${s.letterSpacing};` : ''}${s.name === 'eyebrow' ? 'text-transform:uppercase;color:var(--ink-2);' : ''}${/hero|celebration/.test(s.name) ? 'background:var(--brand-text);-webkit-background-clip:text;background-clip:text;color:transparent;' : ''}${/streak|metric|stat/.test(s.name) ? 'font-variant-numeric:tabular-nums;' : ''}" title="${esc(s.usage)}">${esc(s.sample)}</div></div>`;
  const [disp, text] = T.type.groups.map(g => g.styles.map(s => typeRow({ ...s, family: g.family || (g.name === 'Display' ? 'display' : 'body') })).join(''));

  const space = T.spacing.tokens.map(t => `<div class="space"><code>${t.name}</code><b>${t.value}</b><i style="--v:${t.value}"></i><small>${md(t.usage)}</small></div>`).join('');
  const radius = T.radius.tokens.map(t => `<div class="rad"><i style="border-radius:${t.name === 'r-pill' ? '48px' : t.value}"></i><b>${t.name} · ${t.value}</b><small>${md(firstSentence(t.usage))}</small></div>`).join('');

  // Les icônes de l'application (pas celles propres au site)
  const icons = appIcons
    .map(n => `<button type="button" class="ico" data-copy="${n}" aria-label="Copier le nom ${n}"><svg class="i"><use href="assets/icons.svg#${n}"/></svg>${n}</button>`).join('');

  return {
    base: ['bg', 'ink', 'ink-2', 'ink-3', 'glass', 'glass-strong', 'glass-card', 'glass-edge', 'line', 'scrim'].map(swatch).join(''),
    brand: ['flame-2', 'flame', 'pink', 'on-accent', 'blob-1', 'blob-2', 'blob-3', 'blob-4'].map(swatch).join(''),
    state: ['focus', 'ok', 'danger'].map(swatch).join(''),
    contrast, types, themecss, display: disp, text, space, radius, icons
  };
}

function firstSentence(s = '') { const m = s.match(/^[^.]*?(\.|$)(?=\s|$)/); return (m ? m[0] : s).trim(); }
function short(v) { return v.replace(/\s+/g, '').replace(/^rgba\((.*)\)$/, 'rgba($1)'); }
function cl(px) { const n = parseFloat(px); return n >= 30 ? `clamp(${Math.round(n * .6)}px,${(n / 13).toFixed(1)}vw,${px})` : px; }
function hex(v) {
  if (v.startsWith('#')) { const h = v.length === 4 ? v.slice(1).split('').map(c => c + c).join('') : v.slice(1, 7); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); }
  return v.match(/[\d.]+/g).slice(0, 3).map(Number);
}
function rel(rgb) { const [r, g, b] = rgb.map(c => { c /= 255; return c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; }
function ratio(a, b) { const [x, y] = [rel(a), rel(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); }
function over(v, bg) { const a = (v.match(/rgba\([^)]*,\s*([\d.]+)\)/) || [])[1]; const f = hex(v), b = hex(bg); return a === undefined ? f : f.map((c, i) => c * +a + b[i] * (1 - +a)); }
