# PepsGoal AI — feuille de route

Document de référence fourni par le propriétaire du produit (version Word d'origine convertie en Markdown). Suivi de l'avancement : [avancement.md](avancement.md).

Transformer des photographies en fonds d’écran illustrés fidèles à
Braise Pop, grâce à un moteur Rust exécuté entièrement sur un VPS
Hostinger KVM 2. L’entraînement peut être réalisé sur une machine GPU
externe ; aucune inférence ne dépend d’un service d’IA tiers.

<img src="media/image1.png"
style="width:1.43077in;height:3.1in" />

Illustration de référence fournie pour le projet.

# 1. Vision, périmètre et critères de réussite

Entrée : photographie personnelle. Sortie : illustration stylisée
compatible avec les fonds PepsGoal Android, avec un éventuel premier
plan transparent et des métadonnées de génération. Le projet privilégie
la fidélité aux lieux et la cohérence graphique plutôt qu’une créativité
générative incontrôlée.

- MVP : un style unique « braise-pop-outdoor-v1 », extensible
  ultérieurement.

- Exécution du modèle et traitement des photos exclusivement sur le VPS
  ; entraînement et export du modèle possibles ailleurs.

- Interface Android : sélection photo, recadrage, soumission,
  progression, prévisualisation, sauvegarde dans un pack.

- Fonctionnement asynchrone avec contrôle des quotas et suppression des
  photos temporaires.

# 2. Identité visuelle Braise Pop

- Aplats de couleurs nets, masses graphiques lisibles, deux à trois
  valeurs d’ombre par matériau.

- Formes organiques simplifiées, trois plans de profondeur, volume et
  ombres de contact.

- Palette vive et maîtrisée : bleu eau, verts, jaunes chauds, ombres
  plus froides.

- Respect de la géométrie des bâtiments et des monuments ; pas de texte,
  filigrane ni photoréalisme.

- Composition verticale : master de travail 1024 × 1536, avec
  vérification du recadrage final 9:19,5.

- Éléments identitaires prioritaires dans la zone horizontale centrale
  (environ 20–80 % de la largeur du master).

- Zone centrale supérieure visuellement calme pour les cartes de
  l’interface.

- Pour les fonds dynamiques : ciel alpha transparent, sans soleil, lune
  ou nuages peints ; météo et astres gérés par Android.

Attention : la photographie de référence comporte un soleil dessiné. Une
version statique peut le conserver, mais la version compatible météo
doit le retirer et produire une vraie transparence.

# 3. Architecture générale

Entraînement externe GPU → export ONNX → comparaison FP32/INT8 →
livraison signée/versionnée du modèle → inférence CPU locale sur VPS →
API Rust HTTPS → application Android.

| Couche        | Choix                    | Responsabilité                                   |
|---------------|--------------------------|--------------------------------------------------|
| Android       | Kotlin / Compose         | Photo, recadrage, progression, import pack       |
| API           | Rust, Axum, Tokio        | Authentification, quotas, jobs                   |
| Imagerie      | image, fast_image_resize | Validation, pré/post-traitement                  |
| Inférence     | ort ou rten              | Modèle ONNX sur CPU                              |
| Style         | Rust                     | Palette, règles de composition, contrôle qualité |
| Persistance   | SQLite via sqlx          | Jobs et états minimaux                           |
| Observabilité | tracing                  | Durées, erreurs, métriques anonymisées           |
| Déploiement   | systemd ou conteneur     | Isolation et redémarrage                         |

# 4. Modèles candidats et stratégie IA

| Approche                      | Intérêt                                               | Décision               |
|-------------------------------|-------------------------------------------------------|------------------------|
| Filtres vectoriels classiques | Très léger ; baseline mesurable                       | À implémenter          |
| Fast Neural Style Transfer    | Prototype rapide, style fixe                          | À tester               |
| MobileNet + décodeur léger    | Faible coût CPU, bonne candidate à la spécialisation  | Priorité               |
| U-Net compact                 | Préservation des structures, segmentation/stylisation | Priorité               |
| AdaIN léger                   | Styles multiples possibles                            | Après MVP              |
| Diffusion SDXL / FLUX         | Créativité, mais coût CPU élevé                       | Non retenu pour le MVP |

Entraîner au minimum deux architectures sur les mêmes jeux de données et
les comparer en qualité, temps, RAM et robustesse. Le modèle final est
sélectionné sur mesures réalisées sur le VPS, pas uniquement sur GPU.

## Dataset et entraînement

- Créer 30 à 50 photographies de test représentatives, jamais utilisées
  pendant l’entraînement.

- Constituer un corpus d’entraînement licite : paysages, architecture,
  végétation, villes et références graphiques PepsGoal.

- Documenter pour chaque source sa provenance, sa licence et les droits
  d’entraînement et de redistribution.

- Ne pas supposer que les illustrations et photos du dépôt sont
  automatiquement réutilisables pour l’entraînement.

- Privilégier des paires photo/illustration lorsque disponibles ; sinon
  évaluer une stylisation perceptuelle ou distillation adaptée.

- Mesurer la préservation des repères visuels et les défauts
  structurels, pas seulement la similarité de palette.

- Exporter en ONNX ; comparer FP32 et INT8, et FP16 uniquement si
  pertinent sur le CPU cible.

# 5. Contrat de sortie PepsGoal

Le dépôt Android contient un type PackWallpaper avec les propriétés
kind, file, foreground, weather et styled. La génération doit viser
cette compatibilité sans inventer un nouveau format de pack pour le MVP.

| Fichier         | Contenu                                                             |
|-----------------|---------------------------------------------------------------------|
| wallpaper.webp  | Illustration principale statique                                    |
| foreground.webp | Calque WebP RGBA détouré, facultatif                                |
| metadata.json   | Version du modèle, profil, dimensions, palette, indicateurs qualité |

Si la segmentation du ciel ou du premier plan est incertaine, désactiver
la compatibilité météo pour le résultat concerné. Les effets dynamiques
restent rendus par Android.

# 6. API asynchrone proposée

| Méthode | Route                | Fonction                                     |
|---------|----------------------|----------------------------------------------|
| POST    | /v1/wallpapers       | Créer un job depuis une photo et des options |
| GET     | /v1/jobs/{id}        | État, progression, erreurs                   |
| GET     | /v1/jobs/{id}/result | Télécharger les artefacts                    |
| DELETE  | /v1/jobs/{id}        | Effacer job et artefacts                     |

États : queued → processing → completed / failed / cancelled. Prévoir
identifiants non prédictibles, expiration des liens, authentification,
quotas et limite de taille et de pixels décodés.

# 7. Infrastructure et objectifs de performance

Hypothèse de dimensionnement KVM 2 : 2 vCPU, 8 Go de RAM, 100 Go NVMe,
sans GPU dédié. Vérifier le contrat Hostinger et les ressources
réellement disponibles avant déploiement. Si d’autres services PepsGoal
cohabitent sur le VPS, leur réserver une marge.

| Profil                | RAM maximale cible du service | Temps cible / image |
|-----------------------|-------------------------------|---------------------|
| Aperçu 512 px         | ≤ 2 Go                        | ≤ 15 s              |
| Standard 768 px       | ≤ 3 Go                        | ≤ 30 s              |
| Haute qualité 1024 px | ≤ 4 Go                        | ≤ 60 s              |

Ces chiffres sont des objectifs expérimentaux, pas des mesures. Démarrer
avec un seul job d’inférence simultané, deux threads CPU au maximum et
un contrôle strict de la mémoire. Envisager le tuilage si nécessaire.
Quantification INT8 : à valider par benchmark, car le gain n’est pas
garanti.

# 8. Roadmap opérationnelle sur 12 à 14 semaines

## Phase 1 — S1–S2 : spécification et dataset

- Extraire les règles Braise Pop et les formats de packs du dépôt
  Android.

- Construire le dataset de test et les critères de validation.

- Inventorier les licences, les droits et les références utilisables.

Livrable : cahier des charges graphique, corpus de test et protocole de
mesure.

## Phase 2 — S3–S4 : prototype Rust

- Créer le workspace Cargo, CLI et pipeline de décodage/recadrage.

- Implémenter une baseline de filtres classiques.

- Exécuter un modèle ONNX de stylisation sur CPU.

Livrable : conversion photo → illustration, benchmarks initiaux.

## Phase 3 — S5–S7 : entraînement GPU externe

- Préparer les données et splits train/validation/test.

- Entraîner MobileNet-décodeur et U-Net compact.

- Comparer fidélité, qualité Braise Pop et robustesse.

- Exporter les meilleurs candidats en ONNX.

Livrable : modèle candidat et rapport comparatif reproductible.

## Phase 4 — S8–S9 : optimisation et pipeline graphique

- Comparer FP32 et INT8 sur le KVM 2.

- Intégrer segmentation ciel/foreground, palette et export WebP RGBA.

- Vérifier recadrage mobile, ciel transparent et repli statique.

Livrable : moteur Rust de production et tests de rendu.

## Phase 5 — S10–S11 : API, sécurité et intégration

- Développer Axum, file d’attente, états de jobs et quotas.

- Sécuriser les uploads, appliquer timeouts et purge.

- Intégrer le parcours photo → aperçu → pack dans Android.

Livrable : bêta bout en bout sur le VPS.

## Phase 6 — S12–S14 : validation et mise en production

- Tests de charge, endurance, confidentialité et non-régression.

- Revue humaine des rendus et tests jour/nuit sur Android.

- Déploiement progressif, feature flag et procédure rollback.

Livrable : V1 déployable avec métriques et documentation.

# 9. Tests et critères d’acceptation

- Tester au moins 50 photos hors entraînement, couvrant cinq catégories
  : paysages, monuments, villes, architecture et végétation.

- Objectif initial : au moins 80 % de rendus jugés utilisables sans
  retouche majeure par revue humaine.

- Aucun monument essentiel tronqué après recadrage final ; aucun ciel
  opaque lorsque weather=true.

- Vérifier artefacts, déformations, aplats, qualité des contours,
  lumière et cohérence entre fonds.

- Tester l’API avec fichiers corrompus, dimensions excessives, pics de
  requêtes, annulations et expiration des jobs.

- Mesurer p50/p95 des durées, RAM maximale, CPU, taux d’échec et
  disponibilité.

- Tester le pack sur plusieurs résolutions Android, avec modes
  clair/sombre et météo.

# 10. Confidentialité, sécurité et exploitation

- HTTPS, authentification et autorisation par utilisateur ; quotas et
  limitation de débit.

- Validation des types MIME et du contenu réel ; limite stricte des
  octets, dimensions et pixels décompressés.

- Isolation du processus de traitement, permissions minimales, aucune
  exécution de commandes à partir de l’upload.

- Stockage temporaire chiffré si requis, purge automatique et
  suppression sur demande ; durée de rétention à définir.

- Aucune photo dans les journaux ; métriques sans données personnelles.

- Vérifier les dépendances et les modèles avant livraison ; conserver
  empreintes et versions.

- Procédure de sauvegarde des métadonnées, reprise après panne et retour
  arrière du modèle.

# 11. Arborescence cible

pepsgoal-ai/  
crates/  
api/ engine/ imaging/ segmentation/  
style/ jobs/ common/  
models/manifest.toml  
benchmarks/photos/  
configs/production.toml  
tests/  
deploy/Dockerfile  
deploy/pepsgoal-ai.service  
Cargo.toml

# 12. Évolutions après MVP

- V1.1 : intensité du style, palettes et variantes graphiques.

- V1.2 : couches météo, cycle jour/nuit et parallaxe avancé.

- V1.3 : segmentation par objets et masques de profondeur plus précis.

- V2.0 : étude de l’inférence directement sur Android avec accélération
  matérielle si disponible.

# 13. Risques et décisions à verrouiller

| Risque                           | Mesure de réduction                                  |
|----------------------------------|------------------------------------------------------|
| Style insuffisamment fidèle      | Validation humaine + entraînement spécialisé         |
| CPU trop lent                    | Modèle compact, quantification testée, file de jobs  |
| Monuments déformés               | Jeu de test architectural, contraintes structurelles |
| Détourage instable               | Score de confiance et repli sans météo               |
| Droits d’entraînement incertains | Registre de provenance et audit des licences         |
| Surcharge du VPS                 | Isolation, RAM plafonnée, une génération à la fois   |

Décisions recommandées : style unique pour V1 ; entraînement externe
autorisé ; modèle ONNX compact ; inférence locale Rust sur CPU ; API
asynchrone ; compatibilité native avec PackWallpaper ; sortie météo
uniquement si détourage validé.

# 14. Sources techniques et références internes

- Dépôt : https://github.com/CorbetQ/pepsgoal-android

- Cahier graphique : docs/design/background-reboot/README.md

- Brief Nantes : docs/design/background-reboot/briefs/nantes.md

- Format des packs : core/src/main/kotlin/fr/pepsgoal/core/PackFormat.kt

- Documentation Hostinger : vérifier les caractéristiques contractuelles
  actuelles du plan KVM 2

- Documentation ONNX Runtime / Rust : https://onnxruntime.ai/ et
  https://github.com/pykeio/ort
