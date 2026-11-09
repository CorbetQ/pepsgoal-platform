"""Export OpenVINO de PepsGoal Style : UNet (DreamShaper 8 + LCM + style PepsGoal fusionnés), ControlNet canny et tile,
encodeur/décodeur VAE, textes du prompt précalculés. Poids compressés en int8 (NNCF). Usage : python export.py <lora> <sortie>"""
import os, sys, numpy as np, torch, openvino as ov, nncf
from diffusers import StableDiffusionControlNetImg2ImgPipeline, ControlNetModel

lora, out = sys.argv[1], sys.argv[2]; os.makedirs(out, exist_ok=True)
LW = float(os.environ.get("LW", "0.7"))
PROMPT = ("pgstyle flat vector illustration, cartoon, thick rounded shapes, soft rounded corners, chunky simplified forms, bold clean shapes, "
          "thick stylized forms, cel shading with two flat tones, highly saturated vibrant colors, warm golden sunlight, purple-blue shadows, "
          "glossy leaves in round clusters, sparkling water with horizontal light streaks, crisp edges, mobile game background, PepsGoal style")
NEG = ("thin lines, sharp spikes, pointy, jagged, intricate details, photo, photorealistic, realistic, 3d render, texture, noise, grain, blurry, "
       "soft focus, gradient mush, text, watermark, signature, dull, desaturated, gray, muddy colors, dark, gloomy, deformed, ugly, people faces")

canny = ControlNetModel.from_pretrained("lllyasviel/control_v11p_sd15_canny", variant="fp16", torch_dtype=torch.float32)
tile = ControlNetModel.from_pretrained("lllyasviel/control_v11f1e_sd15_tile", torch_dtype=torch.float32)
pipe = StableDiffusionControlNetImg2ImgPipeline.from_pretrained("Lykon/dreamshaper-8", controlnet=canny, variant="fp16", torch_dtype=torch.float32, safety_checker=None)
pipe.load_lora_weights("latent-consistency/lcm-lora-sdv1-5", weight_name="pytorch_lora_weights.safetensors", adapter_name="lcm")
pipe.load_lora_weights(os.path.dirname(lora), weight_name=os.path.basename(lora), adapter_name="pg")
pipe.set_adapters(["lcm", "pg"], adapter_weights=[1.0, LW])
pipe.fuse_lora(adapter_names=["lcm", "pg"]); pipe.unload_lora_weights()

with torch.no_grad():
    pe, ne = pipe.encode_prompt(PROMPT, "cpu", 1, True, NEG)
np.save(f"{out}/embeds.npy", torch.cat([ne, pe]).numpy())  # ordre du guidage : [négatif, positif]

D = ov.Dimension(-1)
def save(model, name, example, inputs, compress=True):
    m = ov.convert_model(model, example_input=example, input=inputs)
    if compress: m = nncf.compress_weights(m)  # int8 : poids 4 fois plus légers, décompressés à la volée
    ov.save_model(m, f"{out}/{name}.xml"); print("ok", name, flush=True)

class Unet(torch.nn.Module):
    def __init__(s, u): super().__init__(); s.u = u
    def forward(s, sample, t, ehs, *res):
        return s.u(sample, t, ehs, down_block_additional_residuals=list(res[:12]), mid_block_additional_residual=res[12], return_dict=False)[0]

class Cn(torch.nn.Module):
    def __init__(s, c): super().__init__(); s.c = c
    def forward(s, sample, t, ehs, cond):
        d, m = s.c(sample, t, ehs, controlnet_cond=cond, return_dict=False); return (*d, m)

with torch.no_grad():
    lat = torch.randn(2, 4, 64, 64); t = torch.tensor(500.0); ehs = torch.randn(2, 77, 768); cond = torch.rand(2, 3, 512, 512)
    res = Cn(canny)(lat, t, ehs, cond)
    cn_in = [ov.PartialShape([D, 4, D, D]), ov.PartialShape([]), ov.PartialShape([D, 77, 768]), ov.PartialShape([D, 3, D, D])]
    save(Cn(canny).eval(), "cn_canny", (lat, t, ehs, cond), cn_in)
    save(Cn(tile).eval(), "cn_tile", (lat, t, ehs, cond), cn_in)
    save(Unet(pipe.unet).eval(), "unet", (lat, t, ehs, *res),
         [ov.PartialShape([D, 4, D, D]), ov.PartialShape([]), ov.PartialShape([D, 77, 768])] + [ov.PartialShape([D, r.shape[1], D, D]) for r in res])

    class Enc(torch.nn.Module):
        def __init__(s, v): super().__init__(); s.v = v
        def forward(s, x): return s.v.encode(x).latent_dist.mean * s.v.config.scaling_factor
    class Dec(torch.nn.Module):
        def __init__(s, v): super().__init__(); s.v = v
        def forward(s, z): return s.v.decode(z / s.v.config.scaling_factor, return_dict=False)[0]
    save(Enc(pipe.vae).eval(), "vae_enc", (torch.rand(1, 3, 512, 512) * 2 - 1,), [ov.PartialShape([1, 3, D, D])], compress=False)
    save(Dec(pipe.vae).eval(), "vae_dec", (torch.randn(1, 4, 64, 64),), [ov.PartialShape([1, 4, D, D])], compress=False)
pipe.scheduler.save_pretrained(f"{out}/scheduler")
print("terminé")
