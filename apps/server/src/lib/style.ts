import sharp from 'sharp';

/*
 * « PepsGoal Style » (10.0) : deux modèles de vision exécutés sur le serveur, jamais sur le téléphone.
 *
 * 1. Découpage du ciel (`segmentSky`) : carte de « ciel probable » (teinte, luminosité, saturation, texture), croissance
 *    de région depuis le haut de l'image, contrainte de ligne d'horizon par colonne puis lissage. Le premier plan est
 *    rendu avec une couche alpha : l'application dessine le ciel, la météo (pluie, neige, nuages, nuit) puis ce premier
 *    plan par-dessus, comme pour ses scènes illustrées.
 * 2. Stylisation (`stylize`) : lissage qui garde les bords, partition des couleurs par k-moyennes (graine déterministe),
 *    couleurs rapprochées de la palette PepsGoal (aplats vifs, ombres prune), ciel redessiné en dégradé à bandes et
 *    contours doux entre les aplats : le rendu « collines braise » des fonds de l'application.
 *
 * Fonctions pures sur des tampons RGB (testées sans base de données) ; `runStyle` enchaîne le tout avec sharp.
 */

export interface StyleOptions {
  /** Stylisation PepsGoal (sinon la photo est gardée telle quelle, seulement recadrée). */
  stylize: boolean;
  /** Adaptation météo : découpage du ciel et premier plan détouré. */
  weather: boolean;
  /** Force de la stylisation, 0 à 1. */
  strength: number;
}

export interface StyleOutput {
  image: Buffer;          // JPEG, fond complet
  foreground: Buffer | null; // WebP avec alpha : tout sauf le ciel (null : pas de ciel trouvé ou option coupée)
  colors: string[];       // couleurs dominantes du résultat, pour proposer une palette au pack
  skyRatio: number;       // part de l'image occupée par le ciel, 0 à 1
  width: number;
  height: number;
  stylized: boolean;
  weather: boolean;
}

/** Taille de travail : côté le plus long. Les fonds de l'application sont affichés en plein écran (1080 × 2400 au plus). */
export const STYLE_MAX_SIDE = 1600;
/** Palette PepsGoal (fonds illustrés et Braise Pop) : ciels, prunes, braises, verts des collines, crème. */
export const PEPS_PALETTE = [
  '#63BEEB', '#8EAFBE', '#5E93CF', '#8E8EC7', '#6761A0', '#3B2F5E', '#2A1420', '#111932',
  '#FFB000', '#FF8A3D', '#FF4A12', '#FF3D96', '#F59E8B', '#FFF7F0', '#4FBF7A', '#2E8B65', '#1F5E4A', '#C9A27A'
];

type RGB = [number, number, number];

export const hexOf = (c: RGB) => '#' + c.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
const rgbOf = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));

function rgbToHsl([r, g, b]: RGB): RGB {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > .5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb([h, s, l]: RGB): RGB {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t: number) => { t = ((t % 1) + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < .5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h / 360 + 1 / 3) * 255, f(h / 360) * 255, f(h / 360 - 1 / 3) * 255];
}

const dist2 = (a: RGB, b: RGB) => { const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2]; return 2 * dr * dr + 4 * dg * dg + 3 * db * db; };

/** Image RGB brute (3 octets par pixel). */
export interface Raster { data: Uint8Array; width: number; height: number }

/** Réduction par moyenne de blocs (aucune dépendance) : carte de travail du découpage. */
export function downscale(src: Raster, w: number): Raster {
  const h = Math.max(1, Math.round(src.height * w / src.width));
  const out = new Uint8Array(w * h * 3);
  const sx = src.width / w, sy = src.height / h;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx)), y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    let r = 0, g = 0, b = 0, n = 0;
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const i = (yy * src.width + xx) * 3; r += src.data[i]!; g += src.data[i + 1]!; b += src.data[i + 2]!; n++; }
    const o = (y * w + x) * 3; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
  }
  return { data: out, width: w, height: h };
}

const lum = (d: Uint8Array, i: number) => .299 * d[i]! + .587 * d[i + 1]! + .114 * d[i + 2]!;

/**
 * Probabilité « ciel » de chaque pixel (0 à 1) d'une petite image : ciel bleu, ciel couvert clair, coucher de soleil
 * (dans le tiers haut), le tout pénalisé par la texture (feuillage, façades) et par la position (bas de l'image).
 */
export function skyScore(img: Raster): Float32Array {
  const { data, width: w, height: h } = img;
  const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = lum(data, i * 3);
  const score = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const xl = x > 0 ? i - 1 : i, xr = x < w - 1 ? i + 1 : i, yu = y > 0 ? i - w : i, yd = y < h - 1 ? i + w : i;
    const grad = Math.abs(L[xr]! - L[xl]!) + Math.abs(L[yd]! - L[yu]!);
    const [hue, sat, l] = rgbToHsl([data[i * 3]!, data[i * 3 + 1]!, data[i * 3 + 2]!]);
    const blue = hue >= 175 && hue <= 260 && sat > .12 && l > .25 ? 1 : 0;
    const overcast = sat < .22 && l > .58 ? .85 : 0;
    // Nuages : clairs, dans la moitié haute (leurs bords sont texturés, d'où un seuil de lissé plus tolérant)
    const cloud = y < h * .55 && l > .62 ? .8 : 0;
    const dusk = y < h * .45 && ((hue < 55 || hue > 300) && sat > .25 && l > .45) ? .6 : 0;
    const night = y < h * .5 && l < .2 && grad < 4 ? .45 : 0;
    const smooth = clamp(1 - (grad - 10) / 34);
    const pos = clamp(1.25 - y / h * 1.4);
    score[i] = Math.max(blue, overcast, cloud, dusk, night) * smooth * pos;
  }
  return score;
}

/**
 * Masque du ciel (1 : ciel) sur la petite image : croissance de région depuis le bord haut à travers les pixels
 * probables et proches en couleur, puis ligne d'horizon par colonne (le ciel ne reprend pas sous un premier plan continu),
 * lissée par une médiane glissante. Renvoie aussi la part de ciel.
 */
export function segmentSky(img: Raster): { mask: Float32Array; ratio: number } {
  const { data, width: w, height: h } = img;
  const score = skyScore(img);
  const sky = new Uint8Array(w * h);
  const queue = new Int32Array(w * h); let qh = 0, qt = 0;
  for (let x = 0; x < w; x++) for (let y = 0; y < Math.max(1, Math.round(h * .03)); y++) {
    const i = y * w + x; if (score[i]! > .45 && !sky[i]) { sky[i] = 1; queue[qt++] = i; }
  }
  while (qh < qt) {
    const i = queue[qh++]!; const x = i % w, y = (i / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx; if (sky[j]) continue;
      const near = Math.abs(data[i * 3]! - data[j * 3]!) + Math.abs(data[i * 3 + 1]! - data[j * 3 + 1]!) + Math.abs(data[i * 3 + 2]! - data[j * 3 + 2]!) < 34;
      if ((score[j]! > .35 && near) || score[j]! > .7) { sky[j] = 1; queue[qt++] = j; }
    }
  }
  // Ligne d'horizon : pour chaque colonne, le ciel s'arrête au premier pixel qui n'en est pas
  const line = new Float32Array(w);
  // Un trou court (bord de nuage, oiseau, câble) n'arrête pas le ciel : il faut un premier plan continu
  const gap = Math.max(3, Math.round(h * .04));
  for (let x = 0; x < w; x++) {
    let y = 0, end = 0, run = 0;
    for (; y < h; y++) { if (sky[y * w + x]) { end = y + 1; run = 0; } else if (++run > gap) break; }
    line[x] = end;
  }
  const k = Math.max(2, Math.round(w / 60)); const smooth = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    const win: number[] = []; for (let d = -k; d <= k; d++) win.push(line[Math.min(w - 1, Math.max(0, x + d))]!);
    win.sort((a, b) => a - b); smooth[x] = win[win.length >> 1]!;
  }
  const mask = new Float32Array(w * h); let n = 0;
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) {
    // Bord adouci sur un pixel de la petite image (environ 6 px à pleine taille)
    const v = clamp(smooth[x]! - y + .5); mask[y * w + x] = v; n += v;
  }
  return { mask, ratio: n / (w * h) };
}

/** Générateur pseudo-aléatoire à graine (mulberry32) : même photo, même résultat. */
function prng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** k-moyennes (initialisation k-means++) sur un échantillon de pixels ; centres triés par population décroissante. */
export function kmeans(img: Raster, k: number, seed = 7, skip?: (i: number) => boolean): { centers: RGB[]; counts: number[] } {
  const rnd = prng(seed);
  const n = img.width * img.height; const step = Math.max(1, Math.floor(n / 24000));
  const pts: RGB[] = [];
  for (let i = 0; i < n; i += step) if (!skip?.(i)) pts.push([img.data[i * 3]!, img.data[i * 3 + 1]!, img.data[i * 3 + 2]!]);
  if (pts.length === 0) return { centers: [[128, 128, 128]], counts: [1] };
  const centers: RGB[] = [pts[Math.floor(rnd() * pts.length)]!];
  const d = new Float64Array(pts.length).fill(Infinity);
  while (centers.length < Math.min(k, pts.length)) {
    let sum = 0; const c = centers[centers.length - 1]!;
    for (let i = 0; i < pts.length; i++) { d[i] = Math.min(d[i]!, dist2(pts[i]!, c)); sum += d[i]!; }
    if (sum === 0) break;
    let r = rnd() * sum, j = 0; while (j < pts.length - 1 && (r -= d[j]!) > 0) j++;
    centers.push([...pts[j]!] as RGB);
  }
  const lab = new Int32Array(pts.length); let counts: number[] = [];
  for (let it = 0; it < 14; it++) {
    const acc = centers.map((): [number, number, number, number] => [0, 0, 0, 0]);
    for (let i = 0; i < pts.length; i++) {
      let best = 0, bd = Infinity; for (let c = 0; c < centers.length; c++) { const v = dist2(pts[i]!, centers[c]!); if (v < bd) { bd = v; best = c; } }
      lab[i] = best; const a = acc[best]!; a[0] += pts[i]![0]; a[1] += pts[i]![1]; a[2] += pts[i]![2]; a[3]++;
    }
    counts = acc.map(a => a[3]!);
    acc.forEach((a, c) => { if (a[3]) centers[c] = [a[0]! / a[3], a[1]! / a[3], a[2]! / a[3]]; });
  }
  const order = centers.map((_, i) => i).sort((a, b) => counts[b]! - counts[a]!);
  return { centers: order.map(i => centers[i]!), counts: order.map(i => counts[i]!) };
}

/**
 * Couleur PepsGoal d'un aplat : saturation relevée, luminosité rangée en paliers nets, puis rapprochée de la couleur
 * de la palette la plus proche ([strength] : 0 garde la couleur de la photo, 1 l'aplat le plus « PepsGoal »).
 */
export function pepsColor(c: RGB, strength: number): RGB {
  const [h, s, l] = rgbToHsl(c);
  const s2 = clamp(s * (1 + .55 * strength) + .06 * strength);
  const band = Math.round(l * 6) / 6;
  const l2 = clamp(l + (band - l) * .6 * strength, .08, .96);
  // Ombres vers la prune, lumières vers la crème (jamais de gris neutre)
  const pushed = hslToRgb([h, s2, l2]);
  const shade: RGB = l2 < .3 ? [42, 20, 32] : l2 > .85 ? [255, 247, 240] : pushed;
  const tinted: RGB = [0, 1, 2].map(i => pushed[i]! + (shade[i]! - pushed[i]!) * .25 * strength) as RGB;
  let near = PEPS_PALETTE[0]!; let bd = Infinity;
  for (const p of PEPS_PALETTE) { const v = dist2(tinted, rgbOf(p)); if (v < bd) { bd = v; near = p; } }
  const target = rgbOf(near); const pull = .38 * strength;
  return [0, 1, 2].map(i => tinted[i]! + (target[i]! - tinted[i]!) * pull) as RGB;
}

/** Couleurs proposées au pack : les aplats dominants, sans doublons proches. */
export function dominantColors(centers: RGB[], max = 6): string[] {
  const out: RGB[] = [];
  for (const c of centers) if (out.every(o => dist2(o, c) > 2600)) out.push(c);
  return out.slice(0, max).map(hexOf);
}

/**
 * Stylisation sur l'image pleine taille (déjà lissée par sharp). [skyMask] (taille de [small]) : ciel redessiné en
 * dégradé à bandes. Renvoie l'image et les couleurs des aplats.
 */
export function stylizeRaster(img: Raster, strength: number, small: Raster, skyMask: Float32Array | null, seed: number): { out: Uint8Array; colors: string[] } {
  const { width: w, height: h, data } = img;
  const sw = small.width, sh = small.height;
  const skyAt = (x: number, y: number) => skyMask ? skyMask[Math.min(sh - 1, (y * sh / h) | 0) * sw + Math.min(sw - 1, (x * sw / w) | 0)]! : 0;
  const k = Math.round(6 + 4 * (1 - strength)); // 6 à 10 aplats
  const { centers } = kmeans(img, k, seed, skyMask ? i => skyAt(i % w, (i / w) | 0) > .5 : undefined);
  const mapped = centers.map(c => pepsColor(c, strength));
  const labels = new Uint8Array(w * h);
  const out = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const p: RGB = [data[i * 3]!, data[i * 3 + 1]!, data[i * 3 + 2]!];
    let best = 0, bd = Infinity; for (let c = 0; c < centers.length; c++) { const v = dist2(p, centers[c]!); if (v < bd) { bd = v; best = c; } }
    labels[i] = best;
  }
  majority(labels, w, h, centers.length, 2);
  // Ciel : couleurs moyennes du haut et de l'horizon, rapprochées de la palette, dégradé à 5 bandes
  let skyTop: RGB = [99, 190, 235], skyLow: RGB = [255, 200, 160];
  if (skyMask) {
    const acc: [number, number, number, number][] = [[0, 0, 0, 0], [0, 0, 0, 0]];
    for (let y = 0; y < h; y += 4) for (let x = 0; x < w; x += 4) {
      if (skyAt(x, y) < .9) continue; const i = (y * w + x) * 3; const a = acc[y < h * .18 ? 0 : 1]!;
      a[0] += data[i]!; a[1] += data[i + 1]!; a[2] += data[i + 2]!; a[3]++;
    }
    if (acc[0]![3]) skyTop = pepsColor([acc[0]![0]! / acc[0]![3]!, acc[0]![1]! / acc[0]![3]!, acc[0]![2]! / acc[0]![3]!], strength);
    if (acc[1]![3]) skyLow = pepsColor([acc[1]![0]! / acc[1]![3]!, acc[1]![1]! / acc[1]![3]!, acc[1]![2]! / acc[1]![3]!], strength); else skyLow = skyTop;
  }
  const edgeA = .5 * strength;
  // Contour seulement entre deux aplats de luminosité nettement différente (pas entre deux verts voisins)
  const L = mapped.map(c => .299 * c[0] + .587 * c[1] + .114 * c[2]);
  const contrast = new Uint8Array(256);
  for (let a = 0; a < mapped.length; a++) for (let b = 0; b < mapped.length; b++) contrast[a * 16 + b] = Math.abs(L[a]! - L[b]!) > 38 ? 1 : 0;
  for (let y = 0; y < h; y++) {
    const band = Math.min(4, Math.floor(y / (h * .62) * 5)) / 4;
    const skyC: RGB = [0, 1, 2].map(i => skyTop[i]! + (skyLow[i]! - skyTop[i]!) * band) as RGB;
    for (let x = 0; x < w; x++) {
      const i = y * w + x; const s = skyAt(x, y);
      const c = mapped[labels[i]!]!;
      // Contour doux : frontière entre deux aplats, assombrie vers la prune
      const edge = x > 0 && y > 0 && ((labels[i - 1] !== labels[i] && contrast[labels[i - 1]! * 16 + labels[i]!]!) || (labels[i - w] !== labels[i] && contrast[labels[i - w]! * 16 + labels[i]!]!));
      const base: RGB = edge ? [0, 1, 2].map(j => c[j]! + (42 - c[j]!) * edgeA) as RGB : c;
      for (let j = 0; j < 3; j++) out[i * 3 + j] = clamp(base[j]! * (1 - s) + skyC[j]! * s, 0, 255);
    }
  }
  return { out, colors: dominantColors([skyTop, ...mapped]) };
}

/**
 * Filtre de majorité 5 × 5 sur les étiquettes ([passes] fois) : supprime les petites taches (herbe, feuillage, bruit)
 * pour garder de grands aplats, comme dans les fonds dessinés de l'application.
 */
export function majority(labels: Uint8Array, w: number, h: number, k: number, passes: number) {
  const tmp = new Uint8Array(labels.length); const cnt = new Int32Array(k);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      cnt.fill(0);
      for (let dy = -2; dy <= 2; dy++) { const yy = Math.min(h - 1, Math.max(0, y + dy)); for (let dx = -2; dx <= 2; dx++) { const xx = Math.min(w - 1, Math.max(0, x + dx)); cnt[labels[yy * w + xx]!]!++; } }
      let best = labels[y * w + x]!; for (let c = 0; c < k; c++) if (cnt[c]! > cnt[best]!) best = c;
      tmp[y * w + x] = best;
    }
    labels.set(tmp);
  }
}

/** Graine stable tirée des octets de l'image. */
export function seedOf(buf: Uint8Array): number { let h = 2166136261; for (let i = 0; i < buf.length; i += 997) { h ^= buf[i]!; h = Math.imul(h, 16777619); } return h >>> 0; }

/** Chaîne complète : photo reçue → fond (JPEG) et, si la météo est demandée et qu'un ciel est trouvé, premier plan (WebP alpha). */
export async function runStyle(input: Buffer, opts: StyleOptions): Promise<StyleOutput> {
  const strength = clamp(opts.strength);
  const base = sharp(input, { failOn: 'error', limitInputPixels: 50_000_000 }).rotate()
    .resize({ width: STYLE_MAX_SIDE, height: STYLE_MAX_SIDE, fit: 'inside', withoutEnlargement: true }).removeAlpha().toColourspace('srgb');
  const { data, info } = await base.clone().raw().toBuffer({ resolveWithObject: true });
  const img: Raster = { data: new Uint8Array(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
  const small = downscale(img, Math.min(240, img.width));
  const needSky = opts.weather || opts.stylize;
  const seg = needSky ? segmentSky(small) : null;
  const hasSky = !!seg && seg.ratio >= .04;
  let rgb: Uint8Array = img.data; let colors: string[];
  if (opts.stylize) {
    // Lissage qui garde les bords (médiane puis léger flou) avant la partition des couleurs
    const r = Math.max(3, Math.round(Math.max(img.width, img.height) / 200)) | 1;
    const sm = await sharp(Buffer.from(img.data), { raw: { width: img.width, height: img.height, channels: 3 } }).median(r).blur(.8).raw().toBuffer();
    const st = stylizeRaster({ data: new Uint8Array(sm.buffer, sm.byteOffset, sm.length), width: img.width, height: img.height }, strength, small, hasSky ? seg!.mask : null, seedOf(img.data));
    rgb = st.out; colors = st.colors;
  } else {
    colors = dominantColors(kmeans(small, 8, seedOf(small.data)).centers);
  }
  const raw = { raw: { width: img.width, height: img.height, channels: 3 as const } };
  const image = await sharp(Buffer.from(rgb), raw).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
  let foreground: Buffer | null = null;
  if (opts.weather && hasSky) {
    const a = new Uint8Array(small.width * small.height);
    for (let i = 0; i < a.length; i++) a[i] = Math.round((1 - seg!.mask[i]!) * 255);
    const alpha = await sharp(Buffer.from(a), { raw: { width: small.width, height: small.height, channels: 1 } })
      .resize(img.width, img.height, { kernel: 'cubic' }).blur(1.2).extractChannel(0).raw().toBuffer();
    const rgba = new Uint8Array(img.width * img.height * 4);
    for (let i = 0; i < img.width * img.height; i++) { rgba[i * 4] = rgb[i * 3]!; rgba[i * 4 + 1] = rgb[i * 3 + 1]!; rgba[i * 4 + 2] = rgb[i * 3 + 2]!; rgba[i * 4 + 3] = alpha[i]!; }
    foreground = await sharp(Buffer.from(rgba), { raw: { width: img.width, height: img.height, channels: 4 } }).webp({ quality: 86, alphaQuality: 90 }).toBuffer();
  }
  return { image, foreground, colors, skyRatio: seg ? Math.round(seg.ratio * 1000) / 1000 : 0, width: img.width, height: img.height, stylized: opts.stylize, weather: !!foreground };
}
