# PG-Net : IA maison « PepsGoal Style » — feuille de route

Objectif : une IA conçue pour une seule tâche, **transformer une photo en fond PepsGoal** (norme
`docs/design/pepsgoal-style.md` du dépôt Android) et **retirer le ciel sur demande**, livrée sous forme d'un binaire Rust
autonome qui tourne sur le VPS de production (Hostinger KVM 2 : 2 vCPU, 8 Go de RAM partagés avec l'API et
Postgres, sans carte graphique).

## Cibles

| Critère | Cible | Pipeline Stable Diffusion actuel (mesuré, 2 cœurs) |
| --- | --- | --- |
| Sortie | 1080 × 1920, PNG avec ciel transparent | idem |
| Temps par image (2 vCPU) | **< 30 s** | 12 à 16 min |
| RAM en pointe | **< 1,5 Go** | 9,5 à 13 Go |
| Taille sur disque | < 50 Mo | 3 à 8 Go |
| Dépendances en production | un binaire Rust, aucun Python | Python, PyTorch, diffusers |
| Licences | 100 % compatibles usage commercial | idem |

## Principe : distillation « maître → élève »

Un modèle génératif sait *dessiner*, mais coûte des milliards d'opérations par image. Notre tâche est beaucoup plus
étroite : un seul style, une seule famille d'images (photos d'extérieur), une sortie qui suit la composition de la photo.
Une telle transformation peut être apprise par un **petit réseau convolutif spécialisé**, à condition de lui montrer des
milliers d'exemples. Ces exemples sont produits par le **maître** : le pipeline Stable Diffusion déjà validé (style LoRA
appris sur les 48 fonds, ControlNet, seconde passe Full HD), qui ne tourne que sur la machine de développement.

```
photo ──► [maître : SD 1.5 + LoRA PepsGoal + ControlNet + passe FHD]  ──► rendu cible + masque du ciel   (hors ligne, une fois)
photo ──► [élève PG-Net, ~3 M de paramètres, Rust]                      ──► rendu + masque du ciel           (production)
```

## Étapes

### Phase 0 — Cadrage (fait)
- Norme de rendu établie sur les 48 fonds.
- Maître validé visuellement (rendus v7 et v8).
- Mesures du maître sur 2 cœurs : inutilisable en production sur KVM 2, d'où PG-Net.

### Phase 1 — Données
1. **Photos** : Unsplash Lite (25 000 photos, licence Unsplash : usage commercial autorisé), filtrées par mots-clés
   (paysage, ville, rivière, mer, montagne, rue, château, parc…) et par taille (≥ 1080 px de large). Cible :
   1 000 à 2 000 photos, recadrées en portrait 9:16.
2. **Paires** : chaque photo passe dans le maître → rendu Full HD + masque du ciel (UperNet ADE20K).
3. **Contrôle qualité automatique** : saturation dans la plage de la norme (0,43 – 0,66), pas de ciel dans le tiers bas,
   part de ciel < 65 % ; les paires rejetées sont écartées.
4. **Banc de validation** : 20 photos jamais vues à l'entraînement (dont les 6 photos de démonstration).

Coût : environ 3 à 4 min par paire sur la machine de développement → 1 000 paires ≈ 2 à 3 jours de calcul en tâche
de fond. L'entraînement commence dès les premières centaines de paires.

### Phase 2 — Architecture PG-Net
- Encodeur-décodeur convolutif (U-Net léger) : 4 niveaux (32-64-128-192 canaux), blocs résiduels à convolutions
  séparables, normalisation par instance, activations SiLU.
- Travail à **540 × 960**, puis **sur-échantillonneur appris ×2** (pixel shuffle) guidé par la photo en pleine
  résolution : les bords et les fenêtres sont dessinés à 1080 × 1920, pas agrandis.
- **Deux sorties** : RVB stylisé et logit du ciel (alpha). Le ciel peut être conservé ou retiré.
- Budget : ~3 M de paramètres, < 25 GFLOP par image Full HD.

### Phase 3 — Entraînement (machine de développement, CPU)
- Pertes : L1 sur l'image, perceptuelle (VGG16), contours (Sobel, pour la netteté), BCE sur le masque du ciel, puis
  adversariale (discriminateur PatchGAN) en fin d'entraînement pour des aplats francs.
- Augmentations : recadrages, miroir, variations d'exposition et de balance des blancs (les photos des utilisateurs
  sont rarement parfaites).
- Suivi : planches de validation à chaque palier, distance perceptuelle (LPIPS) au maître, saturation moyenne.

### Phase 4 — Moteur Rust `pgstyle`
- Binaire unique : lecture de la photo (orientation EXIF), recadrage 9:16, inférence, alpha du ciel, écriture PNG.
- Inférence avec `tract` (moteur ONNX en Rust pur, sans dépendance système) ; poids figés dans le binaire ou dans un
  fichier `.onnx` à côté.
- Inférence par bandes pour borner la RAM ; poids quantifiés en int8 si la qualité le permet.
- Options : `--sky keep|remove`, `--strength` (mélange avec la photo), `--threads`.
- Tests : rendu identique (à 1/255 près) à la version Python de référence ; temps et RAM mesurés avec 2 threads.

### Phase 5 — Intégration à l'API
- Le serveur Node appelle `pgstyle` (processus enfant), un calcul à la fois, file d'attente et progression.
- Image Docker : binaire Rust statique (musl) + modèle, quelques dizaines de Mo.
- `POST /v1/style` garde son contrat (`stylize`, `weather` → ciel retiré).

### Phase 6 — Validation
- Planches photo | maître | PG-Net sur le banc de 20 photos, validation visuelle par le propriétaire du produit.
- Mesures sur 2 cœurs (temps, RAM), comparées aux cibles.

## Risques

| Risque | Parade |
| --- | --- |
| L'élève est moins fin que le maître | sur-échantillonneur guidé, perte de contours, perte adversariale ; augmenter les paires |
| Pas assez de paires (calcul long) | entraînement progressif dès 200 paires ; maître sans IP-Adapter, en bf16 |
| Photos hors domaine (intérieur, portrait) | QC à l'entrée : refus poli si le ciel et le paysage sont absents |
| Entraînement CPU lent | réseau compact, recadrages 384 px, entraînement en tâche de fond avec points de reprise |
