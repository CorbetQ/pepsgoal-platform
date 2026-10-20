// Contenus repris de l'application (apps/web-legacy/pepsgoal.html) : couleurs d'accent (ACCENTS) et familles de badges
// à paliers (BADGE_FAMILIES), avec les ajouts des versions suivantes (ACCENTS.push, BADGE_FAMILIES.push).
const fileOf = e => [...e].map(c => c.codePointAt(0)).filter(c => c !== 0xfe0f).map(c => c.toString(16)).join('-') + '.webp';
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const pl = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const fmtNum = n => Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',');

// Tableau déclaré par `const NAME = [ … ];`, complété par chaque `NAME.push( … );`
function appArray(src, name) {
  const a = src.indexOf(`const ${name} = [`), b = src.indexOf('\n];', a);
  if (a < 0 || b < 0) throw new Error(`${name} introuvable dans pepsgoal.html`);
  const read = code => Function('pl', 'fmtNum', `return ${code}`)(pl, fmtNum);
  const list = read(src.slice(a + `const ${name} = `.length, b + 2));
  for (const m of src.matchAll(new RegExp(`\\n${name}\\.push\\(`, 'g'))) {
    const start = m.index + m[0].length, end = src.indexOf('\n);', start);
    if (end > start) list.push(...read(`[${src.slice(start, end)}]`));
  }
  return list;
}

export function appBlocks(src) {
  const accents = appArray(src, 'ACCENTS');
  const tiers = Function(`return ${src.match(/const BADGE_TIERS = (\[.*?\]);/)[1]}`)();
  const fams = appArray(src, 'BADGE_FAMILIES');
  // Exemple de progression : un palier différent selon la famille, sans dépasser ceux qu'elle possède
  const SAMPLE = [2, 2, 1, 1, 1, 0, 1, 2, 1, 0, 1, 2, 1, 0, 1, 2, 0, 1, 1];
  const badges = fams.map((f, i) => {
    const t = Math.min(SAMPLE[i] ?? i % 3, f.t.length - 1), [tier, color] = tiers[t];
    const desc = f.d(f.t[t]).replace(/ \(.*\)$/, '');
    return `<div class="bdg tier" style="--t:${color}"><img src="emoji/${fileOf(f.e)}" alt="" width="28" height="28" loading="lazy"><b>${esc(f.n)}</b><small>${esc(desc)}</small><span class="tier-pill">${tier}</span></div>`;
  }).join('');
  return {
    accents: JSON.stringify(accents.map(a => [a.n, ...a.c])),
    accentcount: String(accents.length),
    accentswatches: `<div class="acc-sw rv">${accents.map(a => `<button type="button" data-copy="${a.c.join(' ')}" aria-label="Copier les couleurs ${esc(a.n)}"><i style="background:linear-gradient(135deg,${a.c[0]},${a.c[1]} 55%,${a.c[2]})"></i>${esc(a.n)}</button>`).join('')}</div>`,
    badgefams: `<div class="badges">${badges}</div>`,
    badgecount: String(fams.length)
  };
}
