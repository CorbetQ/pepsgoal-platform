// Échantillon du sélecteur d'emojis de l'application (constante EMOJI_CATS de apps/web-legacy/pepsgoal.html) :
// les 12 catégories et leurs premiers emojis, en images Fluent copiées depuis apps/web/emoji dans deploy/site/emoji.
import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const fileOf = e => [...e].map(c => c.codePointAt(0)).filter(c => c !== 0xfe0f).map(c => c.toString(16)).join('-') + '.webp';
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

export function emojiPicker(appSource, srcDir, outDir, perCat = 12) {
  const a = appSource.indexOf('const EMOJI_CATS = ['), b = appSource.indexOf('\n];', a);
  if (a < 0 || b < 0) throw new Error('Catalogue d’emojis introuvable dans pepsgoal.html (EMOJI_CATS)');
  const cats = Function(`return ${appSource.slice(a + 'const EMOJI_CATS = '.length, b + 2)}`)();
  const has = e => existsSync(path.join(srcDir, fileOf(e)));
  // Seuls les emojis affichés sont copiés dans le site
  const img = e => {
    const f = fileOf(e);
    copyFileSync(path.join(srcDir, f), path.join(outDir, f));
    return `<img src="emoji/${f}" alt="${esc(e)}" width="26" height="26" loading="lazy">`;
  };
  const total = cats.reduce((n, c) => n + c[3].length, 0);
  const tabs = cats.map(([k, label, ic], i) => `<button type="button" class="ep-cat" role="tab" id="ep-t-${k}" aria-controls="ep-p-${k}" aria-selected="${i === 0}" tabindex="${i ? -1 : 0}" title="${esc(label)}" aria-label="${esc(label)}">${has(ic) ? img(ic) : esc(ic)}</button>`).join('');
  const panels = cats.map(([k, label, , list], i) => {
    const cells = list.filter(has).slice(0, perCat)
      .map(e => `<button type="button" class="ep-e" aria-pressed="false" aria-label="${esc(e)}">${img(e)}</button>`).join('');
    return `<div class="ep-panel" role="tabpanel" id="ep-p-${k}" aria-labelledby="ep-t-${k}"${i ? ' hidden' : ''}><p class="ep-label">${esc(label)} <span>· ${list.length} emojis</span></p><div class="ep-grid">${cells}</div></div>`;
  }).join('');
  return { emojipicker: `<div class="ep" data-ep><div class="ep-cats" role="tablist" aria-label="Catégories d’emojis">${tabs}</div>${panels}</div>`, emojitotal: String(total), emojicats: String(cats.length) };
}
