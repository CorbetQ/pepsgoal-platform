//! Imagerie PepsGoal AI : lecture sûre des photos (taille, pixels décodés, orientation EXIF), recadrage au master 2:3
//! et profils de calcul (feuille de route §2, §7, §10).

use anyhow::{bail, Context, Result};
use image::{imageops::FilterType, DynamicImage, ImageReader, RgbImage};
use std::io::Cursor;

/// Octets maximum d'une photo reçue.
pub const MAX_BYTES: usize = 20 * 1024 * 1024;
/// Pixels décodés maximum (protection contre les bombes de décompression).
pub const MAX_PIXELS: u64 = 50_000_000;

/// Profil de calcul : largeur du master (le master est en 2:3).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Profile { Preview, Standard, High }

impl Profile {
    pub fn parse(s: &str) -> Result<Self> {
        Ok(match s { "512" | "apercu" | "preview" => Self::Preview, "768" | "standard" => Self::Standard, "1024" | "hq" | "high" => Self::High, o => bail!("profil inconnu : {o}") })
    }
    /// Dimensions du master pour ce profil (largeur × hauteur, 2:3, multiples de 16).
    pub fn size(self) -> (u32, u32) { match self { Self::Preview => (512, 768), Self::Standard => (768, 1152), Self::High => (1024, 1536) } }
    pub fn name(self) -> &'static str { match self { Self::Preview => "512", Self::Standard => "768", Self::High => "1024" } }
}

/// Lit une photo depuis ses octets : type réel vérifié (pas l'extension), taille et pixels bornés, orientation EXIF.
pub fn decode(bytes: &[u8]) -> Result<RgbImage> {
    if bytes.len() > MAX_BYTES { bail!("photo trop lourde ({} Mo, maximum {} Mo)", bytes.len() / 1_048_576, MAX_BYTES / 1_048_576); }
    let reader = ImageReader::new(Cursor::new(bytes)).with_guessed_format().context("format illisible")?;
    match reader.format() {
        Some(image::ImageFormat::Jpeg | image::ImageFormat::Png | image::ImageFormat::WebP) => {}
        _ => bail!("format non pris en charge : JPEG, PNG ou WebP uniquement"),
    }
    let (w, h) = reader.into_dimensions().context("dimensions illisibles")?;
    if w as u64 * h as u64 > MAX_PIXELS { bail!("photo trop grande ({w} × {h})"); }
    let mut reader = ImageReader::new(Cursor::new(bytes)).with_guessed_format()?;
    let mut limits = image::Limits::default(); limits.max_alloc = Some(MAX_PIXELS * 4);
    reader.limits(limits);
    let img = reader.decode().context("photo corrompue")?;
    Ok(orient(img, exif_orientation(bytes)).to_rgb8())
}

fn exif_orientation(bytes: &[u8]) -> u32 {
    exif::Reader::new().read_from_container(&mut Cursor::new(bytes)).ok()
        .and_then(|e| e.get_field(exif::Tag::Orientation, exif::In::PRIMARY).and_then(|f| f.value.get_uint(0)))
        .unwrap_or(1)
}

fn orient(img: DynamicImage, o: u32) -> DynamicImage {
    match o { 2 => img.fliph(), 3 => img.rotate180(), 4 => img.flipv(), 5 => img.rotate90().fliph(), 6 => img.rotate90(), 7 => img.rotate270().fliph(), 8 => img.rotate270(), _ => img }
}

/// Recadrage au format 2:3 du master. [focus_x] : centre horizontal du recadrage (0 à 1, 0,5 par défaut) ;
/// le recadrage final 9:19,5 se vérifie ensuite sur la bande centrale (cahier des charges §1).
pub fn master(img: &RgbImage, profile: Profile, focus_x: f32) -> RgbImage {
    let (tw, th) = profile.size();
    let (w, h) = img.dimensions();
    let target = tw as f32 / th as f32;
    let (cw, ch) = if w as f32 / h as f32 > target { ((h as f32 * target) as u32, h) } else { (w, (w as f32 / target) as u32) };
    let x = ((w - cw) as f32 * focus_x.clamp(0.0, 1.0)) as u32;
    let y = (h - ch) / 2;
    let crop = image::imageops::crop_imm(img, x, y, cw, ch).to_image();
    image::imageops::resize(&crop, tw, th, FilterType::Lanczos3)
}

/// Bande visible sur un téléphone 9:19,5 à partir d'un master 2:3 (rognage des côtés) : (x0, largeur).
pub fn phone_band(master_w: u32, master_h: u32) -> (u32, u32) {
    let w = (master_h as f32 * 9.0 / 19.5).round() as u32;
    let w = w.min(master_w);
    ((master_w - w) / 2, w)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn master_is_2_3_and_phone_band_centered() {
        let img = RgbImage::new(4000, 3000);
        let m = master(&img, Profile::High, 0.5);
        assert_eq!(m.dimensions(), (1024, 1536));
        let (x, w) = phone_band(1024, 1536);
        assert_eq!(w, 709); assert_eq!(x, 157);
    }
    #[test]
    fn rejects_non_images_and_oversize() {
        assert!(decode(b"pas une image").is_err());
        assert!(decode(&vec![0u8; MAX_BYTES + 1]).is_err());
    }
}
