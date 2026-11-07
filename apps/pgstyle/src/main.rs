//! `pgstyle` : IA maison « PepsGoal Style » (PG-Net). Transforme une photo en fond PepsGoal 1080 × 1920 et retire le
//! ciel sur demande. Un seul binaire, aucune dépendance système ; conçu pour 2 vCPU et peu de mémoire.
//!
//! Usage : pgstyle --model pgnet.onnx --in photo.jpg --out fond.png [--sky keep|remove] [--strength 1.0]
//! Sortie : PNG RVBA (ciel transparent avec --sky remove). Une ligne JSON sur la sortie standard (temps, part de ciel).

use anyhow::{bail, Context, Result};
use image::{imageops::FilterType, DynamicImage, ImageBuffer, Rgba, RgbImage};
use std::time::Instant;
use tract_onnx::prelude::*;

const W: u32 = 1080;
const H: u32 = 1920;

struct Args { model: String, input: String, output: String, sky_remove: bool, strength: f32 }

fn args() -> Result<Args> {
    let mut a = Args { model: "pgnet.onnx".into(), input: String::new(), output: String::new(), sky_remove: false, strength: 1.0 };
    let v: Vec<String> = std::env::args().skip(1).collect();
    let mut i = 0;
    while i < v.len() {
        let next = || v.get(i + 1).cloned().context("valeur manquante");
        match v[i].as_str() {
            "--model" => a.model = next()?,
            "--in" => a.input = next()?,
            "--out" => a.output = next()?,
            "--sky" => a.sky_remove = next()? == "remove",
            "--strength" => a.strength = next()?.parse::<f32>()?.clamp(0.0, 1.0),
            o => bail!("option inconnue : {o}"),
        }
        i += 2;
    }
    if a.input.is_empty() || a.output.is_empty() { bail!("usage : pgstyle --model pgnet.onnx --in photo.jpg --out fond.png [--sky keep|remove] [--strength 1]"); }
    Ok(a)
}

/// Lit la photo en respectant l'orientation EXIF (photos de téléphone).
fn load(path: &str) -> Result<RgbImage> {
    let img = image::open(path).with_context(|| format!("photo illisible : {path}"))?;
    let orient = std::fs::File::open(path).ok()
        .and_then(|f| exif::Reader::new().read_from_container(&mut std::io::BufReader::new(f)).ok())
        .and_then(|e| e.get_field(exif::Tag::Orientation, exif::In::PRIMARY).and_then(|f| f.value.get_uint(0)))
        .unwrap_or(1);
    let img = match orient { 3 => img.rotate180(), 6 => img.rotate90(), 8 => img.rotate270(), _ => img };
    Ok(img.to_rgb8())
}

/// Recadrage centré au format 9:16 puis mise à 1080 × 1920.
fn portrait(img: RgbImage) -> RgbImage {
    let (w, h) = img.dimensions();
    let (cw, ch) = if w as f32 / h as f32 > W as f32 / H as f32 { ((h as f32 * W as f32 / H as f32) as u32, h) } else { (w, (w as f32 * H as f32 / W as f32) as u32) };
    let cropped = DynamicImage::ImageRgb8(img).crop_imm((w - cw) / 2, (h - ch) / 2, cw, ch);
    cropped.resize_exact(W, H, FilterType::Lanczos3).to_rgb8()
}

fn main() -> Result<()> {
    let a = args()?;
    let t0 = Instant::now();
    let model = tract_onnx::onnx().model_for_path(&a.model)?
        .with_input_fact(0, f32::fact([1, 3, H as usize, W as usize]).into())?
        .into_optimized()?.into_runnable()?;
    let t_load = t0.elapsed().as_secs_f32();

    let photo = portrait(load(&a.input)?);
    let x: Tensor = tract_ndarray::Array4::from_shape_fn((1, 3, H as usize, W as usize), |(_, c, y, x)| {
        photo.get_pixel(x as u32, y as u32)[c] as f32 / 127.5 - 1.0
    }).into();
    let t1 = Instant::now();
    let out = model.run(tvec!(x.into()))?;
    let t_run = t1.elapsed().as_secs_f32();

    let rgb = out[0].to_array_view::<f32>()?;
    let sky = out[1].to_array_view::<f32>()?;
    let mut buf: ImageBuffer<Rgba<u8>, Vec<u8>> = ImageBuffer::new(W, H);
    let mut sky_sum = 0f64;
    for (x, y, p) in buf.enumerate_pixels_mut() {
        let (xu, yu) = (x as usize, y as usize);
        let src = photo.get_pixel(x, y);
        let mut c = [0u8; 4];
        for k in 0..3 {
            let v = (rgb[[0, k, yu, xu]] + 1.0) * 127.5;
            let v = a.strength * v + (1.0 - a.strength) * src[k] as f32;
            c[k] = v.round().clamp(0.0, 255.0) as u8;
        }
        let s = 1.0 / (1.0 + (-sky[[0, 0, yu, xu]]).exp());
        sky_sum += s as f64;
        c[3] = if a.sky_remove { ((1.0 - s) * 255.0).round() as u8 } else { 255 };
        *p = Rgba(c);
    }
    buf.save(&a.output)?;
    println!("{{\"ok\":true,\"chargement\":{t_load:.2},\"calcul\":{t_run:.2},\"total\":{:.2},\"ciel\":{:.3}}}",
             t0.elapsed().as_secs_f32(), sky_sum / (W * H) as f64);
    Ok(())
}
