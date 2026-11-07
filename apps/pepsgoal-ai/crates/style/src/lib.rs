//! Style « braise-pop-outdoor-v1 » : baseline de filtres classiques (feuille de route §4, « très léger, baseline
//! mesurable ») et contrôles qualité automatiques du cahier des charges §6 / protocole de mesure.
//!
//! Baseline : lissage de Kuwahara (aplats, bords conservés, formes arrondies) → partition des couleurs (k-moyennes) →
//! palette Braise Pop (saturation, ombres froides, lumières chaudes) → ombrage en trois valeurs par matériau.

use image::{Rgb, RgbImage};

/* ---------------------------------------------------------------- couleur */

fn rgb_to_hsl(c: [f32; 3]) -> [f32; 3] {
    let (r, g, b) = (c[0] / 255.0, c[1] / 255.0, c[2] / 255.0);
    let (mx, mn) = (r.max(g).max(b), r.min(g).min(b));
    let l = (mx + mn) / 2.0;
    if mx == mn { return [0.0, 0.0, l]; }
    let d = mx - mn;
    let s = if l > 0.5 { d / (2.0 - mx - mn) } else { d / (mx + mn) };
    let h = if mx == r { (g - b) / d + if g < b { 6.0 } else { 0.0 } } else if mx == g { (b - r) / d + 2.0 } else { (r - g) / d + 4.0 };
    [h * 60.0, s, l]
}

fn hsl_to_rgb(c: [f32; 3]) -> [f32; 3] {
    let [h, s, l] = c;
    if s <= 0.0 { return [l * 255.0; 3]; }
    let q = if l < 0.5 { l * (1.0 + s) } else { l + s - l * s };
    let p = 2.0 * l - q;
    let f = |t: f32| { let t = t.rem_euclid(1.0); if t < 1.0 / 6.0 { p + (q - p) * 6.0 * t } else if t < 0.5 { q } else if t < 2.0 / 3.0 { p + (q - p) * (2.0 / 3.0 - t) * 6.0 } else { p } };
    [f(h / 360.0 + 1.0 / 3.0) * 255.0, f(h / 360.0) * 255.0, f(h / 360.0 - 1.0 / 3.0) * 255.0]
}

fn lum(c: [f32; 3]) -> f32 { 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] }

/// Couleur Braise Pop d'un aplat : saturation relevée, ombres vers le bleu-violet, lumières vers l'orangé doré.
pub fn braise(c: [f32; 3], amount: f32) -> [f32; 3] {
    let [mut h, mut s, mut l] = rgb_to_hsl(c);
    s = (s * (1.0 + 0.6 * amount) + 0.08 * amount).min(1.0);
    if l < 0.38 { // ombre froide
        let t = (0.38 - l) / 0.38 * 0.35 * amount;
        h = h + (250.0 - h) * t; s = (s + 0.1 * amount).min(1.0);
    } else if l > 0.68 && !(150.0..280.0).contains(&h) { // lumière chaude (pas sur l'eau ni le ciel)
        let t = (l - 0.68) / 0.32 * 0.3 * amount;
        let hh = if h > 300.0 { h - 360.0 } else { h };
        h = (hh + (42.0 - hh) * t).rem_euclid(360.0);
    }
    l = l.clamp(0.08, 0.95);
    hsl_to_rgb([h, s, l])
}

/* ---------------------------------------------------------------- Kuwahara */

/// Filtre de Kuwahara (rayon [r]) par images intégrales : chaque pixel prend la moyenne du quadrant le moins varié.
/// Donne des aplats aux bords nets et aux contours arrondis, en O(pixels) quel que soit le rayon.
pub fn kuwahara(img: &RgbImage, r: u32) -> RgbImage {
    let (w, h) = img.dimensions();
    let (wi, hi) = (w as usize + 1, h as usize + 1);
    // intégrales de R, G, B et de la luminance au carré (la variance est jugée sur la luminance)
    let mut sum = vec![[0f64; 4]; wi * hi];
    for y in 0..h as usize {
        let mut row = [0f64; 4];
        for x in 0..w as usize {
            let p = img.get_pixel(x as u32, y as u32).0;
            let l = lum([p[0] as f32, p[1] as f32, p[2] as f32]) as f64;
            row[0] += p[0] as f64; row[1] += p[1] as f64; row[2] += p[2] as f64; row[3] += l * l;
            let above = sum[y * wi + x + 1];
            sum[(y + 1) * wi + x + 1] = [above[0] + row[0], above[1] + row[1], above[2] + row[2], above[3] + row[3]];
        }
    }
    let mut lsum = vec![0f64; wi * hi];
    for y in 0..h as usize { let mut row = 0f64; for x in 0..w as usize {
        let p = img.get_pixel(x as u32, y as u32).0; row += lum([p[0] as f32, p[1] as f32, p[2] as f32]) as f64;
        lsum[(y + 1) * wi + x + 1] = lsum[y * wi + x + 1] + row; } }
    let rect = |x0: i64, y0: i64, x1: i64, y1: i64| -> ([f64; 4], f64, f64) {
        let (x0, y0) = (x0.clamp(0, w as i64) as usize, y0.clamp(0, h as i64) as usize);
        let (x1, y1) = (x1.clamp(0, w as i64) as usize, y1.clamp(0, h as i64) as usize);
        let n = ((x1 - x0) * (y1 - y0)).max(1) as f64;
        let g = |a: usize, b: usize| sum[b * wi + a];
        let mut s = [0f64; 4];
        for k in 0..4 { s[k] = g(x1, y1)[k] - g(x0, y1)[k] - g(x1, y0)[k] + g(x0, y0)[k]; }
        let ls = lsum[y1 * wi + x1] - lsum[y1 * wi + x0] - lsum[y0 * wi + x1] + lsum[y0 * wi + x0];
        (s, ls, n)
    };
    let r = r as i64;
    let mut out = RgbImage::new(w, h);
    for y in 0..h as i64 { for x in 0..w as i64 {
        let quads = [(x - r, y - r, x + 1, y + 1), (x, y - r, x + r + 1, y + 1), (x - r, y, x + 1, y + r + 1), (x, y, x + r + 1, y + r + 1)];
        let mut best = (f64::MAX, [0f64; 3]);
        for (x0, y0, x1, y1) in quads {
            let (s, ls, n) = rect(x0, y0, x1, y1);
            let mean_l = ls / n; let var = s[3] / n - mean_l * mean_l;
            if var < best.0 { best = (var, [s[0] / n, s[1] / n, s[2] / n]); }
        }
        out.put_pixel(x as u32, y as u32, Rgb([best.1[0] as u8, best.1[1] as u8, best.1[2] as u8]));
    } }
    out
}

/* ---------------------------------------------------------------- k-moyennes */

/// k-moyennes déterministes sur un échantillon (initialisation k-means++ à graine fixe).
pub fn kmeans(img: &RgbImage, k: usize, seed: u64) -> Vec<[f32; 3]> {
    let px: Vec<[f32; 3]> = img.pixels().step_by(((img.width() * img.height()) as usize / 20000).max(1)).map(|p| [p[0] as f32, p[1] as f32, p[2] as f32]).collect();
    let mut st = seed.max(1);
    let mut rnd = || { st ^= st << 13; st ^= st >> 7; st ^= st << 17; (st % 1_000_000) as f32 / 1_000_000.0 };
    let d2 = |a: [f32; 3], b: [f32; 3]| 2.0 * (a[0] - b[0]).powi(2) + 4.0 * (a[1] - b[1]).powi(2) + 3.0 * (a[2] - b[2]).powi(2);
    let mut c = vec![px[(rnd() * px.len() as f32) as usize % px.len()]];
    let mut dist = vec![f32::MAX; px.len()];
    while c.len() < k {
        let last = *c.last().unwrap(); let mut total = 0.0;
        for (i, p) in px.iter().enumerate() { dist[i] = dist[i].min(d2(*p, last)); total += dist[i]; }
        if total <= 0.0 { break; }
        let mut t = rnd() * total; let mut j = 0;
        while j < px.len() - 1 { t -= dist[j]; if t <= 0.0 { break; } j += 1; }
        c.push(px[j]);
    }
    for _ in 0..12 {
        let mut acc = vec![[0f32; 4]; c.len()];
        for p in &px {
            let j = (0..c.len()).min_by(|&a, &b| d2(*p, c[a]).total_cmp(&d2(*p, c[b]))).unwrap();
            acc[j][0] += p[0]; acc[j][1] += p[1]; acc[j][2] += p[2]; acc[j][3] += 1.0;
        }
        for (j, a) in acc.iter().enumerate() { if a[3] > 0.0 { c[j] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]; } }
    }
    c
}

/* ---------------------------------------------------------------- baseline */

/// Paramètres de la baseline.
pub struct Baseline { pub radius: u32, pub passes: u32, pub colors: usize, pub amount: f32 }
impl Default for Baseline { fn default() -> Self { Self { radius: 5, passes: 2, colors: 12, amount: 1.0 } } }

/// Photo (master) → illustration Braise Pop par filtres classiques.
pub fn baseline(img: &RgbImage, p: &Baseline) -> RgbImage {
    let scale = img.width() as f32 / 1024.0;
    let r = ((p.radius as f32 * scale).round() as u32).max(2);
    let mut flat = img.clone();
    for _ in 0..p.passes { flat = kuwahara(&flat, r); }
    let centers = kmeans(&flat, p.colors, 7);
    let pal: Vec<[f32; 3]> = centers.iter().map(|c| braise(*c, p.amount)).collect();
    let d2 = |a: [f32; 3], b: [f32; 3]| 2.0 * (a[0] - b[0]).powi(2) + 4.0 * (a[1] - b[1]).powi(2) + 3.0 * (a[2] - b[2]).powi(2);
    let mut out = RgbImage::new(img.width(), img.height());
    for (x, y, px) in flat.enumerate_pixels() {
        let c = [px[0] as f32, px[1] as f32, px[2] as f32];
        let j = (0..centers.len()).min_by(|&a, &b| d2(c, centers[a]).total_cmp(&d2(c, centers[b]))).unwrap();
        // trois valeurs par matériau : la luminance locale décide lumière / moyen / ombre autour de l'aplat
        let dl = (lum(c) - lum(centers[j])) / 255.0;
        let base = pal[j];
        let v = if dl > 0.06 { braise([base[0] * 1.12 + 10.0, base[1] * 1.12 + 8.0, base[2] * 1.05], 0.6) }
                else if dl < -0.06 { braise([base[0] * 0.78, base[1] * 0.78, base[2] * 0.86 + 6.0], 0.6) } else { base };
        out.put_pixel(x, y, Rgb([v[0].clamp(0.0, 255.0) as u8, v[1].clamp(0.0, 255.0) as u8, v[2].clamp(0.0, 255.0) as u8]));
    }
    kuwahara(&out, 2) // nettoyage des pixels isolés entre deux valeurs
}

/* ---------------------------------------------------------------- contrôles qualité */

/// Saturation moyenne (TSL) des pixels non transparents ; cible 0,43 – 0,66.
pub fn mean_saturation(img: &RgbImage, alpha: Option<&[u8]>) -> f32 {
    let (mut s, mut n) = (0f64, 0f64);
    for (i, p) in img.pixels().enumerate() {
        if alpha.map_or(false, |a| a[i] < 128) { continue; }
        s += rgb_to_hsl([p[0] as f32, p[1] as f32, p[2] as f32])[1] as f64; n += 1.0;
    }
    if n > 0.0 { (s / n) as f32 } else { 0.0 }
}

/// Carte de bords (Sobel sur la luminance, seuil relatif au 90e centile).
pub fn edges(img: &RgbImage) -> Vec<bool> {
    let (w, h) = (img.width() as usize, img.height() as usize);
    let l: Vec<f32> = img.pixels().map(|p| lum([p[0] as f32, p[1] as f32, p[2] as f32])).collect();
    let mut g = vec![0f32; w * h];
    for y in 1..h - 1 { for x in 1..w - 1 {
        let at = |dx: isize, dy: isize| l[(y as isize + dy) as usize * w + (x as isize + dx) as usize];
        let gx = at(1, -1) + 2.0 * at(1, 0) + at(1, 1) - at(-1, -1) - 2.0 * at(-1, 0) - at(-1, 1);
        let gy = at(-1, 1) + 2.0 * at(0, 1) + at(1, 1) - at(-1, -1) - 2.0 * at(0, -1) - at(1, -1);
        g[y * w + x] = (gx * gx + gy * gy).sqrt();
    } }
    let mut sorted = g.clone(); sorted.sort_by(|a, b| a.total_cmp(b));
    let t = sorted[(sorted.len() as f32 * 0.9) as usize].max(20.0);
    g.iter().map(|v| *v >= t && *v > 0.0).collect()
}

/// F1 entre les bords de deux images de même taille, avec une tolérance de [tol] pixels (fidélité des structures).
pub fn edge_f1(a: &RgbImage, b: &RgbImage, tol: usize) -> f32 {
    let (w, h) = (a.width() as usize, a.height() as usize);
    let (ea, eb) = (edges(a), edges(b));
    let near = |e: &Vec<bool>, x: usize, y: usize| {
        for dy in -(tol as isize)..=tol as isize { for dx in -(tol as isize)..=tol as isize {
            let (xx, yy) = (x as isize + dx, y as isize + dy);
            if xx >= 0 && yy >= 0 && (xx as usize) < w && (yy as usize) < h && e[yy as usize * w + xx as usize] { return true; } } }
        false
    };
    let (mut tp_b, mut nb, mut tp_a, mut na) = (0f32, 0f32, 0f32, 0f32);
    for y in 0..h { for x in 0..w {
        if eb[y * w + x] { nb += 1.0; if near(&ea, x, y) { tp_b += 1.0; } }
        if ea[y * w + x] { na += 1.0; if near(&eb, x, y) { tp_a += 1.0; } }
    } }
    let (p, r) = (if nb > 0.0 { tp_b / nb } else { 0.0 }, if na > 0.0 { tp_a / na } else { 0.0 });
    if p + r > 0.0 { 2.0 * p * r / (p + r) } else { 0.0 }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hsl_roundtrip() { let c = [200.0, 120.0, 40.0]; let r = hsl_to_rgb(rgb_to_hsl(c)); for k in 0..3 { assert!((r[k] - c[k]).abs() < 1.0); } }
    #[test]
    fn kuwahara_keeps_a_hard_edge() {
        let img = RgbImage::from_fn(40, 40, |x, _| if x < 20 { Rgb([10, 10, 10]) } else { Rgb([240, 240, 240]) });
        let k = kuwahara(&img, 4);
        assert!(k.get_pixel(18, 20)[0] < 30 && k.get_pixel(21, 20)[0] > 220);
    }
    #[test]
    fn identical_images_have_f1_one() {
        let img = RgbImage::from_fn(60, 60, |x, y| if (x / 10 + y / 10) % 2 == 0 { Rgb([0, 0, 0]) } else { Rgb([255, 255, 255]) });
        assert!(edge_f1(&img, &img, 1) > 0.99);
    }
}
