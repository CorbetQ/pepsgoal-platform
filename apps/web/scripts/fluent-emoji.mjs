#!/usr/bin/env node
// Génère les emojis Fluent (Microsoft, licence MIT) utilisés par PepsGoal à la place des emojis du système.
//
// Source : https://github.com/microsoft/fluentui-emoji (style « Color », teinte de peau par défaut).
// Les SVG d'origine pèsent 40 Mo : ils sont convertis en WebP 96 px, chargés un par un, à la demande.
// Résultat (à valider dans git) : apps/web/emoji/<code>.webp, apps/web/emoji/index.json, apps/web/emoji/LICENSE
//
// Usage (une seule fois, ou pour récupérer de nouveaux emojis) :
//   git clone --depth 1 --filter=blob:none --sparse https://github.com/microsoft/fluentui-emoji.git /tmp/fluentui-emoji
//   git -C /tmp/fluentui-emoji sparse-checkout set --no-cone '/assets/*/metadata.json' '/assets/*/Color/*.svg' '/assets/*/Default/Color/*.svg' '/LICENSE'
//   npm install --no-save sharp
//   node apps/web/scripts/fluent-emoji.mjs /tmp/fluentui-emoji
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 96, QUALITY = 80;
const src = process.argv[2];
if (!src || !existsSync(path.join(src, 'assets'))) { console.error('Indique le dossier du dépôt fluentui-emoji (voir l’en-tête du script).'); process.exit(1); }
let sharp;
try { sharp = (await import('sharp')).default; } catch { console.error('Installe d’abord sharp : npm install --no-save sharp'); process.exit(1); }

const out = process.env.EMOJI_OUT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../emoji');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// Clé d'un emoji : ses points de code en hexadécimal, sans le sélecteur de variante FE0F (ex. « 1f469-200d-1f4bb »)
const keyOf = unicode => unicode.toLowerCase().split(/[\s-]+/).filter(c => c && c !== 'fe0f').join('-');
const keys = [];
let bytes = 0;
for (const dir of readdirSync(path.join(src, 'assets'))) {
  const base = path.join(src, 'assets', dir), metaFile = path.join(base, 'metadata.json');
  if (!existsSync(metaFile)) continue;
  const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
  const colorDir = [path.join(base, 'Color'), path.join(base, 'Default', 'Color')].find(existsSync);
  const svg = colorDir && readdirSync(colorDir).find(f => f.endsWith('.svg'));
  if (!svg || !meta.unicode) continue;
  const key = keyOf(meta.unicode);
  const buf = await sharp(path.join(colorDir, svg), { density: 300 }).resize(SIZE, SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: QUALITY, alphaQuality: 90, effort: 6 }).toBuffer();
  writeFileSync(path.join(out, `${key}.webp`), buf);
  keys.push(key); bytes += buf.length;
}
keys.sort();
writeFileSync(path.join(out, 'index.json'), JSON.stringify(keys) + '\n');
if (existsSync(path.join(src, 'LICENSE'))) copyFileSync(path.join(src, 'LICENSE'), path.join(out, 'LICENSE'));
console.log(`${keys.length} emojis Fluent générés dans apps/web/emoji (${(bytes / 1e6).toFixed(1)} Mo).`);
