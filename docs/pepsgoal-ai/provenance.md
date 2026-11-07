# Registre de provenance et de licences

Feuille de route §4 : « documenter pour chaque source sa provenance, sa licence et les droits d'entraînement et de
redistribution ». Un élément marqué **À confirmer** ne doit pas entrer dans un modèle livré tant que le propriétaire du
produit ne l'a pas validé.

## Données

| Source | Usage | Licence | Entraînement | Redistribution | Statut |
| --- | --- | --- | --- | --- | --- |
| Unsplash Dataset Lite (25 000 photos ; métadonnées via `1aurent/unsplash-lite` sur Hugging Face, images via `images.unsplash.com`) | photos d'entraînement (1 500 sélectionnées) et corpus de test (50) | [Unsplash License](https://unsplash.com/license) et conditions du [Unsplash Dataset](https://github.com/unsplash/datasets) (Lite : usage commercial et non commercial) | oui (conditions du Dataset Lite) | **non** : les photos ne sont jamais livrées avec le modèle ni dans l'application | Validé sous réserve de relecture des conditions du Dataset |
| Fonds PepsGoal (48 `artwork.png` du dépôt Android) | style appris par le maître (LoRA) ; référence visuelle de la norme | produits par l'outil de génération d'images de l'agent artiste (`image_gen`), d'après des photographies de recherche non distribuées ; voir `docs/design/background-reboot/art-log.md` | oui : **confirmé par le propriétaire du produit le 7 novembre 2026** | déjà distribués dans l'application | Validé |
| Rendus du maître (paires photo → illustration) | cibles d'entraînement de l'élève | dérivés des deux lignes ci-dessus et des modèles ci-dessous | oui si les deux sources le sont | non (internes) | Suit les deux lignes ci-dessus |
| 6 photos de démonstration (Tübingen, Golden Gate, Chicago…) issues de dépôts GitHub de transfert de style | démonstrations visuelles seulement | licences des dépôts d'origine, non vérifiées | **non** (exclues de l'entraînement) | non | Exclues |

## Modèles (maître, hors production)

| Modèle | Rôle | Licence |
| --- | --- | --- |
| Lykon/dreamshaper-8 (Stable Diffusion 1.5) | dessin | CreativeML OpenRAIL-M |
| latent-consistency/lcm-lora-sdv1-5 | accélération | OpenRAIL++ |
| lllyasviel/control_v11p_sd15_canny, control_v11f1e_sd15_tile | guidage | OpenRAIL |
| LoRA « pgstyle » (maison) | style PepsGoal | dérivé des fonds PepsGoal (voir ci-dessus) |
| Real-ESRGAN x4plus | agrandissement | BSD-3-Clause |
| openmmlab/upernet-convnext-small (ADE20K) | segmentation du ciel, tri des photos | MIT (fiche du modèle) |
| VGG16 (timm `vgg16.tv_in1k`) | perte perceptuelle à l'entraînement | BSD-3-Clause (torchvision) |

Seuls les **poids de l'élève** (et leur code) sont livrés en production. Ils sont entraînés sur les rendus du maître : les
licences OpenRAIL imposent de respecter leurs restrictions d'usage (pas d'usage illicite, etc.), compatibles avec PepsGoal.

## Dépendances du moteur Rust

| Crate | Licence |
| --- | --- |
| tract-onnx | MIT / Apache-2.0 |
| image | MIT / Apache-2.0 |
| kamadak-exif | BSD-2-Clause |
| anyhow | MIT / Apache-2.0 |
