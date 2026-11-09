"""Finitions PepsGoal Style après le dessin (sans réseau, < 1 s) :
1. zones unies de la photo (chaussée, mur lisse) : le rendu y est lissé en suivant les bords de la photo (filtre guidé),
   ce qui efface les motifs inventés sans toucher aux contours réels ;
2. garde-fou de couleur : un grand objet que la photo ne montre pas violet ne doit pas le devenir (la tour Eiffel) ;
   la teinte est ramenée vers celle de la photo (ou un brun chaud si elle est grise). Les ombres prune peu
   saturées (règle Braise Pop) ne sont pas touchées."""
import numpy as np, cv2

def box(x, r): return cv2.boxFilter(x, -1, (2 * r + 1, 2 * r + 1), borderType=cv2.BORDER_REFLECT)

def guided(I, p, r, eps):
    """Filtre guidé (He et al.) : guide I (gris, H × W), entrée p (H × W × 3), en float32 0..1."""
    mI = box(I, r); vI = box(I * I, r) - mI * mI
    out = np.empty_like(p)
    for c in range(p.shape[2]):
        pc = p[..., c]; mp = box(pc, r); cov = box(I * pc, r) - mI * mp
        A = cov / (vI + eps); B = mp - A * mI
        out[..., c] = box(A, r) * I + box(B, r)
    return out

def smooth01(x, a, b): t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)

def flat_map(photo):
    """1 là où la photo est unie (peu de gradients sur ~25 px), 0 sur les détails. Calculé à demi-résolution."""
    g = cv2.cvtColor(photo, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255
    h, w = g.shape; s = cv2.resize(g, (w // 2, h // 2), interpolation=cv2.INTER_AREA)
    s = cv2.GaussianBlur(s, (0, 0), 4)  # la texture fine (pavés, crépi) ne compte pas : seule la structure reste
    mag = np.hypot(cv2.Sobel(s, cv2.CV_32F, 1, 0, ksize=3), cv2.Sobel(s, cv2.CV_32F, 0, 1, ksize=3))
    dens = box(mag, 12)
    f = 1 - smooth01(dens, 0.05, 0.09)
    f = cv2.GaussianBlur(f, (0, 0), 4)
    return cv2.resize(f, (w, h), interpolation=cv2.INTER_LINEAR)

def fix_flat(photo, out, sky=None, strength=0.9):
    f = flat_map(photo)
    if sky is not None: f = f * (1 - sky)  # le ciel de l'app est déjà un dégradé propre
    I = cv2.GaussianBlur(cv2.cvtColor(photo, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255, (0, 0), 6)
    o = out.astype(np.float32) / 255
    sm = guided(I, o, 20, 2e-3)
    w = (f * strength)[..., None]
    return np.clip((o * (1 - w) + sm * w) * 255, 0, 255).astype(np.uint8), f

def fix_color(photo, out):
    lo = cv2.cvtColor(out, cv2.COLOR_RGB2LAB).astype(np.float32)
    lp = cv2.cvtColor(cv2.GaussianBlur(photo, (0, 0), 6), cv2.COLOR_RGB2LAB).astype(np.float32)
    L = lo[..., 0] * 100 / 255; a, b = lo[..., 1] - 128, lo[..., 2] - 128
    pa, pb = lp[..., 1] - 128, lp[..., 2] - 128
    hue = np.degrees(np.arctan2(b, a)); C = np.hypot(a, b)
    phue = np.degrees(np.arctan2(pb, pa)); pC = np.hypot(pa, pb)
    purple = lambda h: smooth01(h, -80, -65) * (1 - smooth01(h, -15, -2))  # violet à magenta
    w = purple(hue) * smooth01(C, 28, 40)  # violet vif seulement : les ombres prune (C < 25) restent
    w = w * (1 - purple(phue) * smooth01(pC, 8, 14))           # la photo est violette : on garde
    w = cv2.GaussianBlur(w, (0, 0), 3) * 0.85
    target = np.where(pC > 8, np.radians(phue), np.radians(55.0))  # teinte de la photo, sinon brun chaud
    nC = np.minimum(C, 30.0)
    na, nb = nC * np.cos(target), nC * np.sin(target)
    lo[..., 1] = 128 + a * (1 - w) + na * w; lo[..., 2] = 128 + b * (1 - w) + nb * w
    return cv2.cvtColor(np.clip(lo, 0, 255).astype(np.uint8), cv2.COLOR_LAB2RGB), w

def postfix(photo, out, sky=None):
    """photo, out : RVB uint8 de même taille ; sky : masque du ciel 0..1 (optionnel)."""
    o, _ = fix_flat(photo, out, sky)
    o, _ = fix_color(photo, o)
    return o

if __name__ == "__main__":
    import sys
    from PIL import Image
    ph = np.array(Image.open(sys.argv[1]).convert("RGB").resize((1080, 1920), Image.LANCZOS))
    ou = np.array(Image.open(sys.argv[2]).convert("RGB"))
    sk = np.array(Image.open(sys.argv[3]).convert("L"), np.float32) / 255 if len(sys.argv) > 4 else None
    o, f = fix_flat(ph, ou, sk); o, w = fix_color(ph, o)
    Image.fromarray(o).save(sys.argv[-1], quality=93)
    Image.fromarray((np.concatenate([f, w], 1) * 255).astype(np.uint8)).save(sys.argv[-1][:-4] + "_masques.jpg")
