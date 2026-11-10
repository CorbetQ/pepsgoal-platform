"""PepsGoal Style sur OpenVINO (cible : VPS KVM 2, 2 vCPU, 8 Go, sans carte graphique).
Photo → recadrage 9:16 → ciel retiré → dessin 576 × 1024 (UNet + ControlNet canny, LCM) → ciel découpé → ×4 → Full HD
→ seconde passe par tuiles (ControlNet tile) → finition → PNG 1080 × 1920 au ciel transparent.
Usage : python pgstyle.py --models <dossier export> --out <dossier> photo1.jpg ..."""
import os, time, glob, argparse, resource, gc, ctypes
import numpy as np, cv2, torch, openvino as ov
from PIL import Image, ImageEnhance, ImageFilter
from diffusers import LCMScheduler
from spandrel import ModelLoader
from transformers import AutoImageProcessor, UperNetForSemanticSegmentation

ap = argparse.ArgumentParser()
ap.add_argument("photos")
ap.add_argument("--limit", type=int, default=100000)
ap.add_argument("--esrgan", type=int, default=0)
ap.add_argument("--models", required=True); ap.add_argument("--out", default="out")
ap.add_argument("--threads", type=int, default=0)
ap.add_argument("--steps", type=int, default=8); ap.add_argument("--strength", type=float, default=0.62)
ap.add_argument("--cn", type=float, default=1.0); ap.add_argument("--cfg", type=float, default=1.5)
ap.add_argument("--rs", type=float, default=0.35); ap.add_argument("--rsteps", type=int, default=3)
ap.add_argument("--edges", type=int, default=1); ap.add_argument("--tri", type=int, default=1); ap.add_argument("--prod", type=int, default=0); ap.add_argument("--postfix", type=int, default=0)
ap.add_argument("--refine", type=int, default=1); ap.add_argument("--seed", type=int, default=7)
a = ap.parse_args()
W, H = 576, 1024
def trim(): gc.collect(); ctypes.CDLL("libc.so.6").malloc_trim(0)
def rss(tag): print("RAM", tag, int(open("/proc/self/status").read().split("VmRSS:")[1].split()[0]) // 1024, "Mo · max",
                    resource.getrusage(resource.RUSAGE_SELF).ru_maxrss // 1024, "Mo", flush=True)
torch.set_num_threads(a.threads or os.cpu_count())

core = ov.Core()
cfg = {"INFERENCE_NUM_THREADS": a.threads} if a.threads else {}
cfg["PERFORMANCE_HINT"] = "LATENCY"
cfg["INFERENCE_PRECISION_HINT"] = os.environ.get("PREC", "f32")
M = {}

def stage(cn, h, w):
    """Compile, à taille fixe, les modèles d'une étape (h × w pixels) ; ceux de l'étape précédente sont libérés."""
    M.clear(); trim()
    lh, lw = h // 8, w // 8; b = 2 if a.cfg > 1 else 1
    def comp(name, shapes):
        m = core.read_model(f"{a.models}/{name}.xml")
        m.reshape({m.inputs[i].any_name: s for i, s in shapes.items()})
        return core.compile_model(m, "CPU", cfg)
    M[cn] = comp(cn, {0: [b, 4, lh, lw], 2: [b, 77, 768], 3: [b, 3, h, w]})
    un = core.read_model(f"{a.models}/unet.xml")
    shp = {un.inputs[0].any_name: [b, 4, lh, lw], un.inputs[2].any_name: [b, 77, 768]}
    for i, r in enumerate(M[cn].outputs): shp[un.inputs[3 + i].any_name] = r.get_partial_shape()
    un.reshape(shp); M["unet"] = core.compile_model(un, "CPU", cfg)
    M["vae_enc"] = comp("vae_enc", {0: [1, 3, h, w]}); M["vae_dec"] = comp("vae_dec", {0: [1, 4, lh, lw]})
    trim()
EMB = np.load(f"{a.models}/embeds.npy")  # [négatif, positif]
sched = LCMScheduler.from_pretrained(f"{a.models}/scheduler")
up = None if not a.esrgan else ModelLoader().load_from_file(glob.glob(os.environ["HF_HOME"] + "/hub/models--lllyasviel--Annotators/snapshots/*/RealESRGAN_x4plus.pth")[0]).eval()
seg_proc = AutoImageProcessor.from_pretrained("openmmlab/upernet-convnext-small")
trim(); rss("modèles chargés")

def run(m, *xs): return [r for r in m(list(xs)).values()]

def img2img(im, cond, cn, strength, steps, cn_scale, seed):
    """LCM image → image guidé par une ControlNet ([cn] : cn_canny ou cn_tile), guidage sans classifieur [cfg]."""
    x = np.array(im, np.float32)[None].transpose(0, 3, 1, 2) / 127.5 - 1
    lat = run(M["vae_enc"], x)[0]
    sched.set_timesteps(steps, strength=strength)
    ts = sched.timesteps
    g = torch.Generator().manual_seed(seed)
    lat = sched.add_noise(torch.from_numpy(lat), torch.randn(lat.shape, generator=g), ts[:1]).numpy()
    c = np.array(cond, np.float32)[None].transpose(0, 3, 1, 2) / 255
    two = a.cfg > 1
    ehs = EMB if two else EMB[1:]; cc = np.concatenate([c, c]) if two else c
    den = lat
    for t in ts:
        li = np.concatenate([lat, lat]) if two else lat
        tt = np.array(float(t), np.float32)
        res = [r * cn_scale for r in run(M[cn], li, tt, ehs, cc)]
        eps = run(M["unet"], li, tt, ehs, *res)[0]
        if two: eps = eps[:1] + a.cfg * (eps[1:] - eps[:1])
        lat_t, den_t = sched.step(torch.from_numpy(eps), t, torch.from_numpy(lat), generator=g, return_dict=False)
        lat, den = lat_t.numpy(), den_t.numpy()
    y = run(M["vae_dec"], den)[0][0].transpose(1, 2, 0)
    return Image.fromarray(np.clip((y + 1) * 127.5, 0, 255).astype(np.uint8))

def app_sky(size):
    w, h = size; g = np.linspace(0, 1, h)[:, None, None]
    top, low = np.array([62, 160, 235]), np.array([190, 228, 250])
    return Image.fromarray(np.broadcast_to(top + (low - top) * g ** 1.2, (h, w, 3)).astype(np.uint8))

def crop_portrait(im):
    r = W / H
    if im.width / im.height > r: nw = int(im.height * r); x = (im.width - nw) // 2; im = im.crop((x, 0, x + nw, im.height))
    else: nh = int(im.width / r); y = (im.height - nh) // 2; im = im.crop((0, y, im.width, y + nh))
    return im.resize((W, H), Image.LANCZOS)

def edges(im, thin=None):
    """Contours de guidage : petits morceaux supprimés, contours épaissis (formes rondes, moins pointues)."""
    g = cv2.bilateralFilter(cv2.cvtColor(np.array(im), cv2.COLOR_RGB2GRAY), 15, 90, 90)
    e = cv2.Canny(g, 100, 220)
    n, lab, st, _ = cv2.connectedComponentsWithStats(e, 8)
    e = np.isin(lab, [i for i in range(1, n) if st[i, cv2.CC_STAT_AREA] >= 20]).astype(np.uint8) * 255
    if a.edges >= 2:
        # v2 : structures peu contrastées (bordures, plaques, joints de mur) ajoutées pour que le dessin ne les invente
        # pas ; seuls les traits allongés sont gardés (la texture des pavés ou de la pierre forme des gribouillis courts)
        g2 = cv2.bilateralFilter(cv2.createCLAHE(2.0, (8, 8)).apply(cv2.cvtColor(np.array(im), cv2.COLOR_RGB2GRAY)), 15, 60, 60)
        e2 = cv2.Canny(g2, 60, 150); n, lab, st, _ = cv2.connectedComponentsWithStats(e2, 8)
        keep = [i for i in range(1, n) if max(st[i, cv2.CC_STAT_WIDTH], st[i, cv2.CC_STAT_HEIGHT]) >= 50 and st[i, cv2.CC_STAT_AREA] >= 50]
        e2 = np.isin(lab, keep).astype(np.float32)
        # seulement là où le guide est vide (pas de contour fort à moins de 25 px) et sans texture (murs de pierre exclus)
        dens = cv2.boxFilter((e2 > 0).astype(np.float32), -1, (41, 41)) + cv2.boxFilter((e > 0).astype(np.float32), -1, (31, 31))
        add = (e2 > 0) & (dens < 0.14)
        if a.edges >= 3:  # v3 : pas de contours enrichis sur la texture fine (pierre, feuillage, gravier)
            ge = cv2.Canny(cv2.GaussianBlur(cv2.cvtColor(np.array(im), cv2.COLOR_RGB2GRAY), (3, 3), 0), 40, 100) > 0
            add &= cv2.boxFilter(ge.astype(np.float32), -1, (31, 31)) < 0.12
        e = np.maximum(e, add.astype(np.uint8) * 255)
    if thin is not None: e = np.maximum(e, thin * 255)  # treillis, câbles, éoliennes, mâts
    e = cv2.dilate(e, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))
    return Image.fromarray(np.stack([e] * 3, -1))

def colorize_if_gray(im):
    """Photo noir et blanc (ou presque) : carte de dégradé Braise Pop par luminance (ombres prune, tons moyens
    terre cuite et ocre, lumières crème) avant le dessin ; sinon le rendu reste gris et échoue au contrôle qualité."""
    lab = cv2.cvtColor(np.array(im), cv2.COLOR_RGB2LAB).astype(np.float32)
    if float(np.hypot(lab[..., 1] - 128, lab[..., 2] - 128).mean()) >= 6: return im, False
    stops = np.array([[0, 46, 30, 58], [.35, 120, 62, 78], [.6, 196, 112, 72], [.8, 232, 176, 96], [1, 252, 236, 206]], np.float32)
    L = np.array(im.convert("L"), np.float32) / 255
    rgb = np.stack([np.interp(L, stops[:, 0], stops[:, c]) for c in (1, 2, 3)], -1)
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)), True

def thin_on_sky(rgb, sky):
    """Traits fins (≤ 9 px) et allongés qui se détachent sur le ciel : treillis, câbles, éoliennes, mâts, cimes.
    Ils sont protégés du retrait du ciel et ajoutés au guide (sinon le ciel les efface et le dessin les invente)."""
    g = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY); k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    th = np.maximum(cv2.morphologyEx(g, cv2.MORPH_BLACKHAT, k), cv2.morphologyEx(g, cv2.MORPH_TOPHAT, k))
    n, lab, st, _ = cv2.connectedComponentsWithStats((th > 22).astype(np.uint8), 8)
    near = cv2.dilate((sky > .3).astype(np.uint8), np.ones((15, 15), np.uint8)) > 0
    cnt = np.bincount(lab.ravel(), minlength=n); on = np.bincount(lab.ravel(), weights=near.ravel().astype(np.float64), minlength=n)
    keep = [i for i in range(1, n) if max(st[i, cv2.CC_STAT_WIDTH], st[i, cv2.CC_STAT_HEIGHT]) >= 30
            and st[i, cv2.CC_STAT_AREA] < 0.35 * st[i, cv2.CC_STAT_WIDTH] * st[i, cv2.CC_STAT_HEIGHT] and on[i] >= 0.5 * cnt[i]]
    return np.isin(lab, keep).astype(np.uint8)

@torch.no_grad()
def sky_mask(im):
    seg = UperNetForSemanticSegmentation.from_pretrained("openmmlab/upernet-convnext-small").eval()
    logits = seg(**seg_proc(images=im, return_tensors="pt")).logits; del seg; trim()
    prob = torch.nn.functional.interpolate(logits, size=(im.height, im.width), mode="bilinear", align_corners=False).softmax(1)[0, 2].numpy()
    m = (prob > .5).astype(np.uint8)
    n, lab = cv2.connectedComponents(m); keep = set(np.unique(lab[0][m[0] > 0])) - {0}
    m = np.isin(lab, list(keep)).astype(np.float32) if keep else np.zeros_like(m, np.float32)
    return cv2.GaussianBlur(m, (5, 5), 0)

@torch.no_grad()
def upscale(im):
    x = torch.from_numpy(np.array(im)).permute(2, 0, 1)[None].float() / 255
    _, _, h, w = x.shape; T, P = 256, 16; out = torch.zeros(1, 3, h * 4, w * 4)
    for y0 in range(0, h, T):
        for x0 in range(0, w, T):
            ya, xa = max(0, y0 - P), max(0, x0 - P); yb, xb = min(h, y0 + T + P), min(w, x0 + T + P)
            r = up(x[:, :, ya:yb, xa:xb]); y1, x1 = min(h, y0 + T), min(w, x0 + T)
            out[:, :, y0 * 4:y1 * 4, x0 * 4:x1 * 4] = r[:, :, (y0 - ya) * 4:(y1 - ya) * 4, (x0 - xa) * 4:(x1 - xa) * 4]
    return Image.fromarray((out[0].permute(1, 2, 0).clamp(0, 1).numpy() * 255).astype(np.uint8)).resize((1080, 1920), Image.LANCZOS)

def refine(im):
    """Seconde passe Full HD par tuiles de 544 px qui se chevauchent : détails fins redessinés (ControlNet tile)."""
    W2, H2 = im.size; T, O = 512, 96
    stage("cn_tile", T, T)
    xs = list(range(0, W2 - T, T - O)) + [W2 - T]; ys = list(range(0, H2 - T, T - O)) + [H2 - T]
    acc = np.zeros((H2, W2, 3), np.float32); wsum = np.zeros((H2, W2, 1), np.float32)
    ramp = np.minimum(1, np.minimum(np.arange(T) + 1, T - np.arange(T)) / O).astype(np.float32)
    wt = (ramp[:, None] * ramp[None, :])[..., None]
    for y in ys:
        for x in xs:
            tile = im.crop((x, y, x + T, y + T))
            r = img2img(tile, tile, "cn_tile", a.rs, a.rsteps, 1.0, a.seed)
            acc[y:y + T, x:x + T] += np.array(r, np.float32) * wt; wsum[y:y + T, x:x + T] += wt
    return Image.fromarray(np.clip(acc / wsum, 0, 255).astype(np.uint8))

def finish(im): return ImageEnhance.Contrast(ImageEnhance.Color(im).enhance(1.25)).enhance(1.08)
def crisp(im): return Image.fromarray(cv2.bilateralFilter(np.array(im), 7, 30, 7)).filter(ImageFilter.UnsharpMask(radius=2, percent=90, threshold=3))


# Génération des paires d'entraînement de PG-Net : photo 1080 × 1920 → rendu du maître + masque du ciel
import json
os.makedirs(a.out, exist_ok=True)
files = sorted(f for f in os.listdir(a.photos) if f.endswith(".jpg") and f != "test.jpg")[:a.limit]
log = open(f"{a.out}/log.jsonl", "a")
for f in files:
    name = f[:-4]
    if os.path.exists(f"{a.out}/{name}.jpg") or os.path.exists(f"{a.out}/{name}.rej"): continue
    t0 = time.time()
    try:
        big = Image.open(f"{a.photos}/{f}").convert("RGB")
        if big.size != (1080, 1920): big = big.resize((1080, 1920), Image.LANCZOS)
    except Exception as e:
        open(f"{a.out}/{name}.rej", "w").write(str(e)); continue
    src = big.resize((W, H), Image.LANCZOS)
    m_src = sky_mask(src); m_in = cv2.dilate(m_src, np.ones((7, 7), np.uint8))
    # Tri à l'entrée : photo de jour avec un vrai ciel et un vrai paysage (le maître dérive sur la nuit et les gros plans)
    lum = float(np.array(src.convert("L")).mean() / 255); sr = float(m_src.mean())
    thin = thin_on_sky(np.array(src), m_src) if a.edges >= 3 else None
    if thin is not None: m_in = m_in * (1 - cv2.dilate(thin, np.ones((5, 5), np.uint8)))
    lattice = False
    if a.edges >= 3:
        # treillis (pylône, gazomètre) : le ciel est découpé en dentelle ; le retirer détruit la structure.
        # On garde alors le ciel de la photo (dessiné avec le reste) et il n'y a pas de version météo.
        mb = (m_src > .5).astype(np.uint8)
        per = (cv2.morphologyEx(mb, cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8)) > 0).sum()
        lattice = mb.sum() > 0 and per / np.sqrt(mb.sum()) > 18
        if lattice: m_in = np.zeros_like(m_in); thin = None
    if a.tri and (lum < 0.3 or sr > 0.6):
        open(f"{a.out}/{name}.rej", "w").write(json.dumps({"entree": True, "lum": lum, "ciel": sr})); print(name, "écartée", flush=True); continue
    if a.edges >= 3: src, gray = colorize_if_gray(src)
    clean = Image.fromarray((np.array(src) * (1 - m_in[..., None]) + np.array(app_sky(src.size)) * m_in[..., None]).astype(np.uint8))
    stage("cn_canny", H, W)
    out = finish(img2img(clean, edges(clean, thin), "cn_canny", a.strength, a.steps, a.cn, a.seed))
    m = np.maximum(sky_mask(out), cv2.GaussianBlur(m_src if thin is None else m_src * (1 - thin), (5, 5), 0))
    out = upscale(out) if a.esrgan else out.resize((1080, 1920), Image.LANCZOS)
    out = crisp(refine(out))
    if a.postfix:  # garde-fou de couleur (postfix.py) ; le lissage des zones unies n'est pas retenu (il floute)
        from postfix import fix_color
        out = Image.fromarray(fix_color(np.array(big), np.array(out))[0])
    # Contrôle qualité (norme PepsGoal Style) : saturation, ciel pas dans le tiers bas, ciel < 65 %
    mf = cv2.resize(m, (1080, 1920))
    hsv = cv2.cvtColor(np.array(out), cv2.COLOR_RGB2HSV); sat = float((hsv[..., 1] / 255.0)[mf < .5].mean()) if (mf < .5).any() else 0
    low = float(m[int(H * 2 / 3):].mean()); sky = float(m.mean())
    ok = sat >= 0.35 and low < 0.05 and sky < 0.65
    meteo = low < 0.05 and sky < 0.65 and sky > 0.04 and not lattice  # version météo (ciel animé) possible
    if a.prod: ok = sat >= 0.35  # production : le fond est toujours livré ; seule la version météo dépend du ciel
    mm = Image.fromarray((mf * 255).astype(np.uint8))
    if ok:
        out.save(f"{a.out}/{name}.jpg", quality=95); mm.save(f"{a.out}/{name}_sky.png")
    else:
        open(f"{a.out}/{name}.rej", "w").write(json.dumps({"sat": sat, "low": low, "sky": sky}))
    log.write(json.dumps({"id": name, "ok": ok, "sat": round(sat, 3), "sky": round(sky, 3), "meteo": bool(meteo), "s": round(time.time() - t0)}) + "\n"); log.flush()
    print(name, "ok" if ok else "rejet", f"{time.time() - t0:.0f}s", flush=True)
