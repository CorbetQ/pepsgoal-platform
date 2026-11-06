import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { CreatorPackBody, StyleQuery, validateContent } from '@pepsgoal/shared';
import { dominantColors, downscale, kmeans, pepsColor, runStyle, segmentSky } from '../src/lib/style.js';
import { previewUrl } from '../src/lib/content.js';

// « PepsGoal Style » et boutique des créateurs (10.0) : modèles de vision et formats, sans base de données

/** Paysage de synthèse : ciel bleu en dégradé au-dessus d'une colline verte texturée (horizon à [hz]). */
function landscape(w: number, h: number, hz: number) {
  const d = new Uint8Array(w * h * 3); let s = 7; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3; const line = h * hz + Math.sin(x / w * 6) * h * .04;
    const c = y < line ? [80 + 60 * y / line, 150 + 40 * y / line, 235] : [50 + 60 * r(), 110 + 70 * r(), 40 + 30 * r()];
    d[i] = c[0]!; d[i + 1] = c[1]!; d[i + 2] = c[2]!;
  }
  return { data: d, width: w, height: h };
}

describe('découpage du ciel', () => {
  it('trouve le ciel au-dessus de l’horizon et pas dans la colline', () => {
    const img = landscape(240, 400, .45);
    const { mask, ratio } = segmentSky(img);
    expect(ratio).toBeGreaterThan(.35); expect(ratio).toBeLessThan(.5);
    expect(mask[10 * 240 + 120]).toBe(1);
    expect(mask[350 * 240 + 120]).toBe(0);
  });

  it('ne trouve pas de ciel dans une image sans ciel (intérieur, feuillage)', () => {
    const img = landscape(240, 400, 0);
    expect(segmentSky(img).ratio).toBeLessThan(.04);
  });
});

describe('stylisation', () => {
  it('k-moyennes déterministes, centres triés par population', () => {
    const img = downscale(landscape(240, 400, .45), 120);
    const a = kmeans(img, 6, 3), b = kmeans(img, 6, 3);
    expect(a.centers).toEqual(b.centers);
    expect(a.counts[0]).toBeGreaterThanOrEqual(a.counts[1]!);
  });

  it('les aplats se rapprochent de la palette PepsGoal sans perdre leur teinte', () => {
    const grey: [number, number, number] = [120, 128, 120];
    const out = pepsColor(grey, 1);
    expect(out.every(v => v >= 0 && v <= 255)).toBe(true);
    expect(pepsColor(grey, 0).map(Math.round)).toEqual(grey.map(Math.round));
    expect(dominantColors([[10, 10, 10], [12, 11, 10], [250, 80, 20]])).toEqual(['#0A0A0A', '#FA5014']);
  });

  it('chaîne complète : JPEG stylisé et premier plan WebP avec transparence', async () => {
    const src = landscape(600, 1000, .45);
    const jpg = await sharp(Buffer.from(src.data), { raw: { width: 600, height: 1000, channels: 3 } }).jpeg().toBuffer();
    const r = await runStyle(jpg, { stylize: true, weather: true, strength: .8 });
    expect(r.stylized).toBe(true); expect(r.weather).toBe(true);
    expect((await sharp(r.image).metadata()).format).toBe('jpeg');
    const fg = await sharp(r.foreground!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(fg.info.channels).toBe(4);
    expect(fg.data[(50 * 600 + 300) * 4 + 3]).toBeLessThan(20);   // ciel : transparent
    expect(fg.data[(900 * 600 + 300) * 4 + 3]).toBeGreaterThan(235); // colline : opaque
    const off = await runStyle(jpg, { stylize: false, weather: false, strength: .8 });
    expect(off.foreground).toBeNull(); expect(off.stylized).toBe(false);
  });
});

describe('boutique des créateurs', () => {
  const pack = {
    schemaVersion: 1, type: 'theme_pack', name: 'Collines', emoji: '⛰️',
    colors: { bg: '#FFF7F0', ink: '#2A1420', surface: '#FFFFFF', surface2: '#FFEDE1', edge: '#F2DED1', accent: ['#FFB000', '#FF4A12', '#FF3D96'], deco: ['#FFE2CC'] },
    wallpaper: { kind: 'image', file: 'fond.jpg', foreground: 'pp.webp', weather: true, styled: true }
  };
  const f = (name: string) => ({ name, url: `https://api.pepsgoal.fr/media/content/${'a'.repeat(64)}.jpg`, sha256: 'a'.repeat(64), size: 10, mime: 'image/jpeg' });

  it('le premier plan cité doit être joint', () => {
    expect(validateContent('theme_pack', pack, [f('fond.jpg')]).ok).toBe(false);
    expect(validateContent('theme_pack', pack, [f('fond.jpg'), f('pp.webp')]).ok).toBe(true);
  });

  it('prix borné, pack valide exigé', () => {
    expect(CreatorPackBody.safeParse({ name: 'X', price: 5001, content: pack, files: [f('fond.jpg'), f('pp.webp')] }).success).toBe(false);
    expect(CreatorPackBody.safeParse({ name: 'X', price: -1, content: pack, files: [f('fond.jpg'), f('pp.webp')] }).success).toBe(false);
    expect(CreatorPackBody.safeParse({ name: 'X', price: 120, content: pack, files: [f('fond.jpg'), f('pp.webp')] }).success).toBe(true);
  });

  it('options de style lues dans la requête, désactivables', () => {
    expect(StyleQuery.parse({})).toEqual({ stylize: true, weather: true, strength: .8 });
    expect(StyleQuery.parse({ stylize: '0', weather: 'false', strength: '0.3' })).toEqual({ stylize: false, weather: false, strength: .3 });
  });

  it('aperçu de la vitrine : l’image du fond du pack', () => {
    expect(previewUrl('theme_pack', pack, [f('fond.jpg')])).toContain('/media/content/');
    expect(previewUrl('theme_pack', { wallpaper: { kind: 'free', key: 'pop' } }, [])).toBeNull();
  });
});
