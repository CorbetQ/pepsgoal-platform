# Avancement — PepsGoal AI

Suivi de la [feuille de route](roadmap.md). Mis à jour à chaque étape.

## Phase 1 — Spécification et dataset · terminée

| Livrable | État |
| --- | --- |
| Règles Braise Pop et format des packs | fait : [cahier des charges](cahier-des-charges.md) (norme mesurée sur les 48 fonds + exigences de la feuille de route) |
| Registre de provenance et licences | fait : [provenance.md](provenance.md) ; droits d'entraînement sur les 48 fonds confirmés par le propriétaire (7 novembre 2026) |
| Protocole de mesure | fait : [protocole-mesure.md](protocole-mesure.md) |
| Corpus de test (50 photos, 5 catégories) | **50 / 50** : `apps/pepsgoal-ai/benchmarks/manifest.json` — 34 Unsplash + 16 photos personnelles (château et cathédrale d'Angers, Notre-Dame, Panthéon, château de Nantes, tram, rues…) ; 15 monuments, 10 villes, 9 architecture, 9 végétation, 7 paysages |
| Corpus d'entraînement | 1 500 photos Unsplash d'extérieur + 101 photos personnelles (traitées en priorité) ; paires générées par le maître « fidèle » (force 0,42) en cours |

## Travaux antérieurs réutilisés

- Maître Stable Diffusion (DreamShaper 8 + LoRA de style appris sur les 48 fonds + ControlNet canny/tile, OpenVINO
  bf16) : sert uniquement à produire des paires photo → illustration (distillation, feuille de route §4).
- Premier essai d'élève (U-Net compact « PG-Net », 1,95 M de paramètres) et moteur Rust (`apps/pgstyle`, tract) :
  chaîne complète validée (photo → ONNX → PNG), 18 à 23 s par image Full HD sur un seul cœur. Abandon du maître
  « inventif » (force 0,58) : l'élève ne pouvait que moyenner ses inventions (flou). Remplacé par le maître fidèle.

## Décisions

- **Pas de GPU** : l'entraînement se fait sur le processeur de la machine de développement (4 cœurs), avec points de
  reprise ; durée de plusieurs jours, réseaux compacts privilégiés.
- Corpus de test complété par des photos personnelles du propriétaire.

## Phase 2 — Prototype Rust · en cours

| Livrable | État |
| --- | --- |
| Workspace Cargo (`apps/pepsgoal-ai` : crates `imaging`, `style`, `engine`, `cli`) | fait |
| Décodage sûr (type réel, 20 Mo, 50 Mpx, EXIF), recadrage master 2:3, profils 512 / 768 / 1024, bande 9:19,5 | fait |
| Baseline de filtres classiques | fait : [rapport](../../apps/pepsgoal-ai/benchmarks/rapports/2026-11-07-baseline-1024.md) (0,6 s, 95 Mo) |
| Inférence ONNX sur CPU (tract) ; sorties `wallpaper.webp`, `foreground.webp`, `metadata.json` | fait (à valider avec l'élève entraîné) |
| Benchmarks 2 threads (`pepsgoal-ai bench`) | fait |

## Phases suivantes

2. Prototype Rust : workspace `apps/pepsgoal-ai` (crates engine, imaging, style), baseline de filtres classiques,
   inférence ONNX, benchmarks 2 threads.
3. Entraînement : U-Net compact et MobileNet-décodeur sur les paires fidèles ; comparaison selon le protocole.
