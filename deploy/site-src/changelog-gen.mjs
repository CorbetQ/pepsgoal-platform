// Notes de version : lues dans CHANGELOG.md (à la racine du dépôt), affichées sur le site
// - changelog : frise courte (page Technique), 4 points par version au plus
// - changelogfull : notes complètes, rubriques comprises (page Notes de version)
import { readFileSync } from 'node:fs';

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');

export function parseChangelog(file) {
  const versions = [];
  let v = null, sec = null;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    let m;
    if ((m = line.match(/^## (\S+)(?: \(([^)]+)\))?/))) { v = { version: m[1], date: m[2] || '', sections: [] }; versions.push(v); sec = null; }
    else if (v && (m = line.match(/^### (.+)/))) { sec = { title: m[1].trim(), items: [] }; v.sections.push(sec); }
    else if (v && (m = line.match(/^- (.+)/))) { if (!sec) { sec = { title: '', items: [] }; v.sections.push(sec); } sec.items.push(m[1].trim()); }
  }
  return versions;
}

export function changelogBlocks(file) {
  const versions = parseChangelog(file);
  if (!versions.length) throw new Error('CHANGELOG.md : aucune version trouvée');
  const head = (v, i) => `<h3>${esc(v.version)}${i === 0 ? ' <span class="chip" style="--c:var(--flame);--c-ink:var(--ink)">actuelle</span>' : ''} <small class="muted" style="font-family:var(--font-body);font-size:13px">${esc(v.date)}</small></h3>`;
  const short = versions.map((v, i) => {
    const items = v.sections.flatMap(s => s.items.map(t => (s.title ? `<b>${esc(s.title)}</b> : ` : '') + inline(t)));
    const shown = items.slice(0, 4);
    return `<div class="tl-i rv"><div class="card">${head(v, i)}<ul>${shown.map(t => `<li>${t}</li>`).join('')}${items.length > shown.length ? `<li><a href="notes-de-version.html#v${v.version.replace(/\./g, '-')}">${items.length - shown.length} autre${items.length - shown.length > 1 ? 's' : ''} nouveauté${items.length - shown.length > 1 ? 's' : ''}</a></li>` : ''}</ul></div></div>`;
  }).join('\n      ');
  const full = versions.map((v, i) => `<article class="card notes-v rv" id="v${v.version.replace(/\./g, '-')}">${head(v, i)}${v.sections.map(s => `${s.title ? `<h4>${esc(s.title)}</h4>` : ''}<ul>${s.items.map(t => `<li>${inline(t)}</li>`).join('')}</ul>`).join('')}</article>`).join('\n    ');
  const toc = versions.map(v => `<a href="#v${v.version.replace(/\./g, '-')}">${esc(v.version)}</a>`).join('');
  return { changelog: short, changelogfull: full, changelogtoc: toc, latestversion: esc(versions[0].version), latestdate: esc(versions[0].date) };
}
