"""v2 (VPS-4) : 512 × 768, recadrages aléatoires en espace latent, rang 32.
Entraînement CPU d'un LoRA de style « pgstyle » sur les 48 fonds PepsGoal (DreamShaper 8, UNet seulement).
Usage : python train.py <dossier backgrounds> <sortie> [--steps 600]"""
import os, sys, math, random, time, argparse
import numpy as np, torch, torch.nn.functional as F
from PIL import Image
from diffusers import StableDiffusionPipeline, DDPMScheduler
from peft import LoraConfig, get_peft_model_state_dict, set_peft_model_state_dict
import glob, re
from diffusers.utils import convert_state_dict_to_diffusers
sys.path.insert(0, os.path.dirname(__file__))
from captions import CAP, TRIGGER

ap = argparse.ArgumentParser()
ap.add_argument("bgdir"); ap.add_argument("out")
ap.add_argument("--steps", type=int, default=600)
ap.add_argument("--rank", type=int, default=32)
ap.add_argument("--lr", type=float, default=2e-4)
ap.add_argument("--w", type=int, default=512); ap.add_argument("--h", type=int, default=768)
a = ap.parse_args()
torch.set_num_threads(os.cpu_count()); torch.manual_seed(1); random.seed(1)

pipe = StableDiffusionPipeline.from_pretrained("Lykon/dreamshaper-8", variant="fp16", torch_dtype=torch.float32, safety_checker=None)
unet, vae, te, tok = pipe.unet, pipe.vae, pipe.text_encoder, pipe.tokenizer
noise_sched = DDPMScheduler.from_config(pipe.scheduler.config)
for m in (unet, vae, te): m.requires_grad_(False)
unet.add_adapter(LoraConfig(r=a.rank, lora_alpha=a.rank, init_lora_weights="gaussian", target_modules=["to_k", "to_q", "to_v", "to_out.0"]))
unet.enable_gradient_checkpointing(); unet.train()
step0 = 0
_ck = sorted(glob.glob(f"{a.out}/pgstyle-*.safetensors"), key=lambda f: int(re.findall(r"(\d+)", os.path.basename(f))[0]))
if _ck:  # reprise après redémarrage du conteneur
    sd0, _ = StableDiffusionPipeline.lora_state_dict(_ck[-1])
    sd0 = {k.replace("unet.", "", 1): v for k, v in sd0.items() if k.startswith("unet.")}
    from diffusers.utils import convert_unet_state_dict_to_peft
    r = set_peft_model_state_dict(unet, convert_unet_state_dict_to_peft(sd0)); step0 = int(re.findall(r"(\d+)", os.path.basename(_ck[-1]))[0])
    print("reprise", _ck[-1], "inattendues", len(r.unexpected_keys), flush=True)
params = [p for p in unet.parameters() if p.requires_grad]
opt = torch.optim.AdamW(params, lr=a.lr, weight_decay=1e-2)

def sky(w, h):
    g = np.linspace(0, 1, h)[:, None, None]; top, low = np.array([62, 160, 235]), np.array([190, 228, 250])
    return Image.fromarray(np.broadcast_to(top + (low - top) * g ** 1.2, (h, w, 3)).astype(np.uint8)).convert("RGBA")

# Données : chaque fond posé sur le ciel de l'app, latents et textes calculés une fois (miroir horizontal en plus)
data = []
with torch.no_grad():
    for k, cap in CAP.items():
        p = f"{a.bgdir}/{k}/art/artwork.png"
        if not os.path.exists(p): continue
        W, H = int(a.w * 1.125) // 8 * 8, int(a.h * 1.125) // 8 * 8
        im = Image.open(p).convert("RGBA").resize((W, H), Image.LANCZOS)
        bg = sky(W, H); bg.alpha_composite(im); im = bg.convert("RGB")
        ids = tok(TRIGGER + cap, padding="max_length", max_length=tok.model_max_length, truncation=True, return_tensors="pt").input_ids
        emb = te(ids)[0]
        for flip in (False, True):
            x = torch.from_numpy(np.array(im.transpose(Image.FLIP_LEFT_RIGHT) if flip else im)).permute(2, 0, 1)[None].float() / 127.5 - 1
            data.append((vae.encode(x).latent_dist.mean * vae.config.scaling_factor, emb))
print("images", len(data), flush=True)

t0 = time.time()
for step in range(step0 + 1, a.steps + 1):
    lat, emb = random.choice(data)
    lw, lh = a.w // 8, a.h // 8; ox, oy = random.randint(0, lat.shape[-1] - lw), random.randint(0, lat.shape[-2] - lh)
    lat = lat[..., oy:oy + lh, ox:ox + lw]
    noise = torch.randn_like(lat)
    t = torch.randint(0, noise_sched.config.num_train_timesteps, (1,))
    pred = unet(noise_sched.add_noise(lat, noise, t), t, emb).sample
    loss = F.mse_loss(pred, noise)
    loss.backward(); torch.nn.utils.clip_grad_norm_(params, 1.0); opt.step(); opt.zero_grad()
    for g in opt.param_groups: g["lr"] = a.lr * 0.5 * (1 + math.cos(math.pi * step / a.steps))
    if step % 10 == 0: print(f"step {step} loss {loss.item():.4f} {(time.time() - t0) / (step - step0):.1f}s/step", flush=True)
    if step % 50 == 0 or step == a.steps:
        os.makedirs(a.out, exist_ok=True)
        sd = convert_state_dict_to_diffusers(get_peft_model_state_dict(unet))
        StableDiffusionPipeline.save_lora_weights(a.out, unet_lora_layers=sd, weight_name=f"pgstyle-{step}.safetensors")
        print("saved", step, flush=True)
