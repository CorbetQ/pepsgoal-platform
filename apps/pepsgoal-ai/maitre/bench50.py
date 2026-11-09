"""Comparatif des versions du maître sur le corpus de test (protocole-mesure.md).
Usage : python bench50.py <photos> <manifest.json> <sortie.md> nom=dossier [nom=dossier ...]
Mesures par version : taux de réussite du contrôle qualité, temps p50/p95, saturation, fidélité des contours
(F1 à 3 px contre la photo), inventions (part des traits du rendu sans structure de la photo à moins de 6 px),
violet inventé (part de pixels violet vif là où la photo ne l'est pas). Planches par catégorie à côté du rapport."""
import sys, os, json, glob
import numpy as np, cv2
from PIL import Image

photos, manifest, report = sys.argv[1:4]
versions = [v.split("=", 1) for v in sys.argv[4:]]
cat = {}
try:
    for e in json.load(open(manifest)):
        cat[e.get("id") or os.path.basename(e.get("file", ""))[:-4]] = e.get("categorie") or e.get("category", "")
except Exception: pass

def edge_map(rgb, lo=60, hi=150):
    g = cv2.cvtColor(cv2.resize(rgb, (540, 960), interpolation=cv2.INTER_AREA), cv2.COLOR_RGB2GRAY)
    return cv2.Canny(cv2.bilateralFilter(g, 9, 50, 50), lo, hi) > 0

def near(e, r): return cv2.dilate(e.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))) > 0

def metrics(ph, out, sky):
    ep, eo = edge_map(ph), edge_map(out)
    land = cv2.resize(sky, (540, 960)) < .5 if sky is not None else np.ones(ep.shape, bool)
    ep, eo = ep & land, eo & land
    prec = (eo & near(ep, 3)).sum() / max(1, eo.sum()); rec = (ep & near(eo, 3)).sum() / max(1, ep.sum())
    f1 = 2 * prec * rec / max(1e-6, prec + rec)
    inv = (eo & ~near(ep, 6)).sum() / max(1, eo.sum())
    lo = cv2.cvtColor(out, cv2.COLOR_RGB2LAB).astype(np.float32); lp = cv2.cvtColor(cv2.GaussianBlur(ph, (0, 0), 6), cv2.COLOR_RGB2LAB).astype(np.float32)
    def purple(l): a, b = l[..., 1] - 128, l[..., 2] - 128; h = np.degrees(np.arctan2(b, a)); return (h > -75) & (h < -5), np.hypot(a, b)
    po, co = purple(lo); pp, cp = purple(lp)
    vi = float(((po & (co > 35)) & ~(pp & (cp > 10))).mean())
    hsv = cv2.cvtColor(out, cv2.COLOR_RGB2HSV); m = cv2.resize(sky, (1080, 1920)) < .5 if sky is not None else np.ones(out.shape[:2], bool)
    return dict(f1=f1, inventions=inv, violet=vi, saturation=float(hsv[..., 1][m].mean() / 255))

ids = sorted(os.path.basename(p)[:-4] for p in glob.glob(f"{photos}/*.jpg"))
res = {}
for name, d in versions:
    logs = {}
    for l in open(f"{d}/log.jsonl"):
        j = json.loads(l); logs[j["id"]] = j
    rows = []
    for i in ids:
        if i not in logs: continue
        r = {"id": i, "ok": logs[i]["ok"], "s": logs[i]["s"], "cat": cat.get(i, i.split("-")[0])}
        if os.path.exists(f"{d}/{i}.jpg"):
            ph = np.array(Image.open(f"{photos}/{i}.jpg").convert("RGB").resize((1080, 1920)))
            out = np.array(Image.open(f"{d}/{i}.jpg").convert("RGB"))
            sk = np.array(Image.open(f"{d}/{i}_sky.png").convert("L"), np.float32) / 255 if os.path.exists(f"{d}/{i}_sky.png") else None
            r.update(metrics(ph, out, sk))
        rows.append(r)
    res[name] = rows

def agg(rows, k):
    v = [r[k] for r in rows if k in r]; return np.mean(v) if v else float("nan")
L = [f"# Comparatif du maître sur le corpus de test\n", f"Photos : {len(ids)}. Versions : " + ", ".join(f"`{n}`" for n, _ in versions) + ".\n",
     "| Version | Rendues | Contrôle qualité | p50 | p95 | Saturation | F1 contours ↑ | Inventions ↓ | Violet inventé ↓ |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
for n, rows in res.items():
    t = sorted(r["s"] for r in rows); q = lambda p: t[int(round((len(t) - 1) * p))] if t else 0
    L.append(f"| {n} | {len(rows)} | {sum(r['ok'] for r in rows)}/{len(rows)} | {q(.5)} s | {q(.95)} s | {agg(rows, 'saturation'):.3f} | "
             f"{agg(rows, 'f1'):.3f} | {agg(rows, 'inventions'):.3f} | {agg(rows, 'violet') * 100:.2f} % |")
cats = sorted({r["cat"] for rows in res.values() for r in rows})
L += ["", "## Par catégorie (F1 contours / inventions)", "", "| Catégorie | " + " | ".join(n for n, _ in versions) + " |", "| --- |" + " --- |" * len(versions)]
for c in cats:
    L.append(f"| {c} | " + " | ".join(f"{agg([r for r in rows if r['cat'] == c], 'f1'):.3f} / {agg([r for r in rows if r['cat'] == c], 'inventions'):.3f}" for rows in res.values()) + " |")
open(report, "w").write("\n".join(L) + "\n"); print("\n".join(L))

# Planches : photo | version 1 | version 2 … , 5 photos par planche
base = os.path.splitext(report)[0]; H = 480; Wc = 270
done = [i for i in ids if all(os.path.exists(f"{d}/{i}.jpg") for _, d in versions)]
for k in range(0, len(done), 5):
    chunk = done[k:k + 5]; sheet = Image.new("RGB", ((Wc + 6) * (1 + len(versions)) * len(chunk), H), "white")
    x = 0
    for i in chunk:
        for f in [f"{photos}/{i}.jpg"] + [f"{d}/{i}.jpg" for _, d in versions]:
            sheet.paste(Image.open(f).convert("RGB").resize((Wc, H)), (x, 0)); x += Wc + 6
        x += 0
    sheet.save(f"{base}-planche-{k // 5 + 1:02d}.jpg", quality=85)
