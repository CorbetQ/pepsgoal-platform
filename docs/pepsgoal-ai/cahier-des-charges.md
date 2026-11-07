# Cahier des charges graphique — style « braise-pop-outdoor-v1 »

Livrable de la phase 1. Fusionne la norme mesurée sur les 48 fonds (`docs/design/pepsgoal-style.md` du dépôt Android)
et les exigences de la feuille de route (§2, §5). En cas de conflit, la feuille de route prévaut.

## 1. Formats

| Élément | Exigence |
| --- | --- |
| Master de travail | 1024 × 1536 (2:3), comme les fonds de l'application |
| Contrôle de recadrage | le master doit rester lisible recadré en 9:19,5 (téléphone) : aucun repère essentiel hors de la bande centrale |
| Profils de calcul | aperçu 512 px, standard 768 px, haute qualité 1024 px (largeur du master ramenée à ce côté) |
| Fichiers | `wallpaper.webp` (illustration), `foreground.webp` (RVBA détouré, facultatif), `metadata.json` |
| Compatibilité | `PackWallpaper(kind = "image", file, foreground, weather, styled)` de `PackFormat.kt`, sans nouveau format |

## 2. Fidélité (priorité du MVP)

- Le lieu reste reconnaissable : silhouettes, proportions et **géométrie des bâtiments et monuments** conservées
  (verticales droites, nombre de tours, ouvertures principales).
- Aucun objet inventé (rocher, ville, personnage, astre) ; aucun élément essentiel retiré.
- Simplification autorisée : textures remplacées par des aplats, petits détails fusionnés.

## 3. Style Braise Pop

- Aplats nets, masses lisibles, **2 à 3 valeurs d'ombre par matériau** (lumière, moyen, ombre).
- Formes organiques simplifiées et arrondies ; volume et ombres de contact ; pas de contour noir.
- Palette vive et maîtrisée : bleu eau, verts, jaunes chauds ; ombres plus froides (bleu-violet), lumière dorée.
- Saturation moyenne des zones opaques entre **0,43 et 0,66** (TSL, mesurée sur les 48 fonds ; médiane 0,57).
- Pas de texte, de filigrane, de photoréalisme ni de grain.

## 4. Composition

- **Trois plans** de profondeur : cadrage (premier plan), sujet, repère à l'horizon.
- Éléments identitaires dans la **bande centrale 20 – 80 %** de la largeur du master.
- **Zone centrale supérieure calme** (haut du master, où se posent les cartes de l'interface) : pas de détail fort.

## 5. Ciel et météo

| Mode | Ciel |
| --- | --- |
| `weather = true` (fond dynamique) | **ciel alpha transparent**, sans soleil, lune ni nuages peints : Android dessine le ciel, la météo et les astres |
| `weather = false` (fond statique) | ciel peint autorisé (soleil compris) |

- Si le détourage du ciel ou du premier plan est incertain (score de confiance sous le seuil), le résultat repasse en
  `weather = false` avec un ciel peint : jamais de ciel opaque livré avec `weather = true`.
- Pas de ciel transparent dans le tiers bas ; ciel transparent < 65 % de l'image.

## 6. Contrôles automatiques (rejet)

| Contrôle | Seuil |
| --- | --- |
| Saturation moyenne hors ciel | 0,43 – 0,66 |
| Ciel transparent dans le tiers bas | < 5 % des pixels |
| Part de ciel transparent | < 65 % |
| Fidélité des contours (F1 des bords photo / rendu, voir protocole) | ≥ seuil fixé à la phase 3 |
| Dimensions, canaux, alpha | conformes au §1 |
