//! Moteur d'inférence PepsGoal AI : modèle ONNX (élève distillé) exécuté sur CPU avec tract (Rust pur).
//! Entrée : master RVB dans [-1, 1] (1, 3, H, W). Sorties : RVB stylisé dans [-1, 1] et logit du ciel.

use anyhow::{Context, Result};
use image::{GrayImage, Luma, Rgb, RgbImage};
use tract_onnx::prelude::*;

type Plan = SimplePlan<TypedFact, Box<dyn TypedOp>, Graph<TypedFact, Box<dyn TypedOp>>>;

pub struct Engine { plan: Plan, w: u32, h: u32 }

pub struct Output { pub image: RgbImage, pub sky: GrayImage }

impl Engine {
    /// Charge et optimise le modèle pour une taille de master fixe (profil).
    pub fn load(path: &str, w: u32, h: u32) -> Result<Self> {
        let plan = tract_onnx::onnx().model_for_path(path).with_context(|| format!("modèle introuvable : {path}"))?
            .with_input_fact(0, f32::fact([1, 3, h as usize, w as usize]).into())?
            .into_optimized()?.into_runnable()?;
        Ok(Self { plan, w, h })
    }

    pub fn run(&self, master: &RgbImage) -> Result<Output> {
        let (w, h) = (self.w as usize, self.h as usize);
        let x: Tensor = tract_ndarray::Array4::from_shape_fn((1, 3, h, w), |(_, c, y, x)| master.get_pixel(x as u32, y as u32)[c] as f32 / 127.5 - 1.0).into();
        let out = self.plan.run(tvec!(x.into()))?;
        let rgb = out[0].to_array_view::<f32>()?; let sky = out[1].to_array_view::<f32>()?;
        let image = RgbImage::from_fn(self.w, self.h, |x, y| {
            let v = |c: usize| ((rgb[[0, c, y as usize, x as usize]] + 1.0) * 127.5).round().clamp(0.0, 255.0) as u8;
            Rgb([v(0), v(1), v(2)])
        });
        let sky = GrayImage::from_fn(self.w, self.h, |x, y| Luma([(255.0 / (1.0 + (-sky[[0, 0, y as usize, x as usize]]).exp())) as u8]));
        Ok(Output { image, sky })
    }
}
