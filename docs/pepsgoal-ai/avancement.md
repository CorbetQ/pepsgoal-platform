# Avancement — PepsGoal AI

Suivi de la [feuille de route](roadmap.md). Mis à jour à chaque étape.

## Phase 1 — Spécification et dataset · en cours

| Livrable | État |
| --- | --- |
| Règles Braise Pop et format des packs | fait : [cahier des charges](cahier-des-charges.md) (norme mesurée sur les 48 fonds + exigences de la feuille de route) |
| Registre de provenance et licences | fait : [provenance.md](provenance.md) ; droits d'entraînement sur les 48 fonds confirmés par le propriétaire (7 novembre 2026) |
| Protocole de mesure | fait : [protocole-mesure.md](protocole-mesure.md) |
| Corpus de test (50 photos, 5 catégories) | **34 / 50** : `apps/pepsgoal-ai/benchmarks/manifest.json` (Unsplash, hors entraînement). Unsplash Lite manque de villes et de monuments : 16 photos à compléter avec des photos personnelles du propriétaire (Angers, Saumur, Rennes, Nantes…), en attente |
| Corpus d'entraînement | 1 500 photos Unsplash d'extérieur ; paires générées par le maître « fidèle » (force 0,42) en cours |

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

## Phases suivantes

2. Prototype Rust : workspace `apps/pepsgoal-ai` (crates engine, imaging, style), baseline de filtres classiques,
   inférence ONNX, benchmarks 2 threads.
3. Entraînement : U-Net compact et MobileNet-décodeur sur les paires fidèles ; comparaison selon le protocole.
