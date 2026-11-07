# Protocole de mesure

Livrable de la phase 1. Toute décision (architecture, quantification, profil) se prend sur ces mesures, **réalisées
dans les conditions du KVM 2** (2 threads, RAM plafonnée), pas seulement sur la machine d'entraînement.

## Corpus de test

- 50 photos hors entraînement, 10 par catégorie : paysages, monuments, villes, architecture, végétation
  (`benchmarks/photos/`, manifeste `benchmarks/manifest.json` : identifiant, catégorie, auteur, licence, URL).
- Jamais utilisées pour entraîner ni pour régler les hyperparamètres (un jeu de validation séparé sert à ça).

## Conditions d'exécution

- Processus limité à **2 threads** (`--threads 2`, `taskset -c 0,1`) et à la RAM du profil (`systemd-run -p MemoryMax=`
  ou cgroup équivalent) ; une seule génération à la fois.
- Mesures répétées 3 fois ; on retient la médiane par photo.

## Mesures techniques

| Mesure | Méthode | Cible (feuille de route §7) |
| --- | --- | --- |
| Temps p50 / p95 | horloge murale, du fichier reçu au WebP écrit | 512 px ≤ 15 s · 768 px ≤ 30 s · 1024 px ≤ 60 s |
| RAM maximale | `VmHWM` du processus (`/proc/<pid>/status`) | ≤ 2 Go · ≤ 3 Go · ≤ 4 Go |
| Taux d'échec | photos refusées ou en erreur / 50 | à suivre |
| Écart FP32 / INT8 | PSNR et différence max entre les deux sorties | à décider en phase 4 |

## Mesures de qualité automatiques

| Mesure | Méthode | Rôle |
| --- | --- | --- |
| Fidélité des structures | F1 entre les bords Canny de la photo et du rendu (tolérance 3 px), à 512 px | détecter objets inventés ou perdus |
| Repères visuels | SSIM de la luminance floutée (σ = 4 px) photo / rendu | préservation de la composition |
| Palette | saturation moyenne hors ciel (cible 0,43 – 0,66), nombre de couleurs dominantes | conformité Braise Pop |
| Aplats | part des pixels dans des régions uniformes (variance locale < seuil) | style vectoriel |
| Ciel | alpha dans le tiers bas, part de ciel, score de confiance du détourage | compatibilité météo |
| Distance au maître | LPIPS (VGG) rendu élève / rendu maître | suivi de l'entraînement |

## Revue humaine

- Planche par photo : photo | rendu | rendu sur fond Android jour et nuit, recadré 9:19,5.
- Le propriétaire du produit note chaque rendu : **utilisable sans retouche majeure** (oui / non) et un défaut principal
  (structure, couleurs, aplats, ciel, recadrage).
- Critère d'acceptation : **≥ 80 % utilisables** ; aucun monument tronqué ; aucun ciel opaque avec `weather = true`.

## Rapport

Chaque campagne produit `benchmarks/rapports/<date>-<modèle>.md` : versions (modèle, moteur, empreintes), tableau
des mesures, planches, décision.
