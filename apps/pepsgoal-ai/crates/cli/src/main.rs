//! `pepsgoal-ai` : CLI du moteur (phase 2 de la feuille de route).
//!
//!   pepsgoal-ai render --in photo.jpg --out dossier [--profile 512|768|1024] [--model eleve.onnx] [--weather]
//!   pepsgoal-ai bench  --dir photos/ --out rapport.json [--profile …] [--model …]
//!
//! Sans `--model`, la baseline de filtres classiques est utilisée. Sorties de `render` (contrat §5) :
//! `wallpaper.webp`, `foreground.webp` (si --weather et détourage fiable) et `metadata.json`.

use anyhow::{bail, Context, Result};
use image::{GrayImage, Rgba, RgbaImage, RgbImage};
use imaging::Profile;
use serde::Serialize;
use std::time::Instant;

const STYLE: &str = "braise-pop-outdoor-v1";

struct Opts { cmd: String, input: String, out: String, dir: String, profile: Profile, model: Option<String>, weather: bool }

fn opts() -> Result<Opts> {
    let v: Vec<String> = std::env::args().skip(1).collect();
    let mut o = Opts { cmd: v.first().cloned().unwrap_or_default(), input: String::new(), out: String::new(), dir: String::new(), profile: Profile::High, model: None, weather: false };
    let mut i = 1;
    while i < v.len() {
        let val = || v.get(i + 1).cloned().context("valeur manquante");
        match v[i].as_str() {
            "--in" => { o.input = val()?; i += 1 } "--out" => { o.out = val()?; i += 1 } "--dir" => { o.dir = val()?; i += 1 }
            "--profile" => { o.profile = Profile::parse(&val()?)?; i += 1 } "--model" => { o.model = Some(val()?); i += 1 }
            "--weather" => o.weather = true,
            x => bail!("option inconnue : {x}"),
        }
        i += 1;
    }
    Ok(o)
}

#[derive(Serialize)]
struct Metadata {
    style: &'static str, moteur: String, modele: String, profil: &'static str, largeur: u32, hauteur: u32,
    weather: bool, part_ciel: f32, confiance_ciel: f32, saturation: f32, fidelite_bords: f32, palette: Vec<String>,
    temps_s: f32, ram_max_mo: u64, bande_telephone: (u32, u32),
}

/// RAM maximale du processus (VmHWM), en Mo.
fn peak_ram_mb() -> u64 {
    std::fs::read_to_string("/proc/self/status").ok()
        .and_then(|s| s.lines().find(|l| l.starts_with("VmHWM:")).and_then(|l| l.split_whitespace().nth(1)?.parse::<u64>().ok()))
        .map(|k| k / 1024).unwrap_or(0)
}

struct Result1 { image: RgbImage, sky: Option<GrayImage>, master: RgbImage }

fn stylize(bytes: &[u8], profile: Profile, engine: Option<&engine::Engine>) -> Result<Result1> {
    let photo = imaging::decode(bytes)?;
    let master = imaging::master(&photo, profile, 0.5);
    Ok(match engine {
        Some(e) => { let o = e.run(&master)?; Result1 { image: o.image, sky: Some(o.sky), master } }
        None => Result1 { image: style::baseline(&master, &style::Baseline::default()), sky: None, master },
    })
}

/// Ciel retenu : relié au haut, absent du tiers bas, < 65 % de l'image ; sinon pas de version météo (§5).
fn sky_ok(sky: &GrayImage) -> (bool, f32, f32) {
    let (w, h) = sky.dimensions();
    let n = (w * h) as f32;
    let part = sky.pixels().filter(|p| p[0] > 127).count() as f32 / n;
    let low = (h * 2 / 3..h).flat_map(|y| (0..w).map(move |x| (x, y))).filter(|&(x, y)| sky.get_pixel(x, y)[0] > 127).count() as f32 / (n / 3.0);
    // confiance : pixels francs (proches de 0 ou de 255)
    let conf = sky.pixels().filter(|p| p[0] < 40 || p[0] > 215).count() as f32 / n;
    (part > 0.04 && part < 0.65 && low < 0.05 && conf > 0.9, part, conf)
}

fn palette(img: &RgbImage) -> Vec<String> {
    style::kmeans(img, 5, 3).iter().map(|c| format!("#{:02X}{:02X}{:02X}", c[0] as u8, c[1] as u8, c[2] as u8)).collect()
}

fn main() -> Result<()> {
    let o = opts()?;
    let (w, h) = o.profile.size();
    let engine = match &o.model { Some(m) => Some(engine::Engine::load(m, w, h)?), None => None };
    let moteur = format!("pepsgoal-ai {}", env!("CARGO_PKG_VERSION"));
    let modele = o.model.clone().unwrap_or_else(|| "baseline-filtres".into());
    match o.cmd.as_str() {
        "render" => {
            let t0 = Instant::now();
            let r = stylize(&std::fs::read(&o.input)?, o.profile, engine.as_ref())?;
            std::fs::create_dir_all(&o.out)?;
            r.image.save(format!("{}/wallpaper.webp", o.out))?;
            let (mut weather, mut part, mut conf) = (false, 0.0, 0.0);
            if let (true, Some(sky)) = (o.weather, &r.sky) {
                let (ok, p, c) = sky_ok(sky); part = p; conf = c;
                if ok {
                    weather = true;
                    let fg = RgbaImage::from_fn(w, h, |x, y| { let c = r.image.get_pixel(x, y); Rgba([c[0], c[1], c[2], 255 - sky.get_pixel(x, y)[0]]) });
                    fg.save(format!("{}/foreground.webp", o.out))?;
                }
            }
            let small = |i: &RgbImage| image::imageops::resize(i, 512, 768, image::imageops::FilterType::Triangle);
            let meta = Metadata { style: STYLE, moteur, modele, profil: o.profile.name(), largeur: w, hauteur: h, weather, part_ciel: part, confiance_ciel: conf,
                saturation: style::mean_saturation(&r.image, None), fidelite_bords: style::edge_f1(&small(&r.master), &small(&r.image), 3),
                palette: palette(&r.image), temps_s: t0.elapsed().as_secs_f32(), ram_max_mo: peak_ram_mb(), bande_telephone: imaging::phone_band(w, h) };
            std::fs::write(format!("{}/metadata.json", o.out), serde_json::to_string_pretty(&meta)?)?;
            println!("{}", serde_json::to_string(&meta)?);
        }
        "bench" => {
            let mut rows = vec![];
            let mut files: Vec<_> = std::fs::read_dir(&o.dir)?.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.extension().map_or(false, |x| x == "jpg")).collect();
            files.sort();
            for p in files {
                let t0 = Instant::now();
                let r = match stylize(&std::fs::read(&p)?, o.profile, engine.as_ref()) { Ok(r) => r, Err(e) => { eprintln!("{} : {e}", p.display()); continue } };
                let t = t0.elapsed().as_secs_f32();
                let small = |i: &RgbImage| image::imageops::resize(i, 512, 768, image::imageops::FilterType::Triangle);
                let name = p.file_stem().unwrap().to_string_lossy().to_string();
                if !o.out.is_empty() { let d = std::path::Path::new(&o.out).with_extension(""); std::fs::create_dir_all(&d)?; r.image.save(d.join(format!("{name}.jpg")))?; }
                let row = serde_json::json!({"photo": name, "temps_s": t, "saturation": style::mean_saturation(&r.image, None),
                    "fidelite_bords": style::edge_f1(&small(&r.master), &small(&r.image), 3), "ram_max_mo": peak_ram_mb()});
                println!("{row}"); rows.push(row);
            }
            let mut ts: Vec<f32> = rows.iter().map(|r| r["temps_s"].as_f64().unwrap() as f32).collect(); ts.sort_by(|a, b| a.total_cmp(b));
            let q = |p: f32| ts.get(((ts.len() as f32 - 1.0) * p).round() as usize).copied().unwrap_or(0.0);
            let summary = serde_json::json!({"modele": modele, "profil": o.profile.name(), "photos": rows.len(), "p50_s": q(0.5), "p95_s": q(0.95), "ram_max_mo": peak_ram_mb(),
                "saturation_moy": rows.iter().map(|r| r["saturation"].as_f64().unwrap()).sum::<f64>() / rows.len().max(1) as f64,
                "fidelite_moy": rows.iter().map(|r| r["fidelite_bords"].as_f64().unwrap()).sum::<f64>() / rows.len().max(1) as f64, "lignes": rows});
            if !o.out.is_empty() { std::fs::write(&o.out, serde_json::to_string_pretty(&summary)?)?; }
            eprintln!("p50 {:.1} s · p95 {:.1} s · RAM max {} Mo", q(0.5), q(0.95), peak_ram_mb());
        }
        _ => bail!("usage : pepsgoal-ai render|bench …"),
    }
    Ok(())
}
