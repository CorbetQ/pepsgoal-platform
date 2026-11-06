# Contenus téléchargeables : API et format

Base de la future plateforme de création : des contenus (packs de thème, fonds,
autocollants, icônes) publiés par la modération, téléchargés par l'application
Android sans mise à jour de l'application. Le format d'un pack de thème est le
même que celui de l'export d'un pack personnel dans l'application (9.2).

- Table : `content_items` (migration `0010_content_items`).
- Schémas zod partagés : `packages/shared/src/content.ts`.
- Routes : `apps/server/src/routes/content.ts`, mise en forme : `src/lib/content.ts`.
- Côté Android : `core/.../PackFormat.kt` (format, validation) et `ContentSync`
  (téléchargement, cache, vérification).

## Modèle

| Champ | Type | Rôle |
| --- | --- | --- |
| `id` | uuid | Identifiant stable. Pour un pack, c'est aussi l'identifiant du pack dans l'application. |
| `type` | `theme_pack` · `background` · `sticker_pack` · `icon` | Nature du contenu. Ne change jamais. |
| `slug` | `^[a-z0-9][a-z0-9-]{1,63}$` | Nom technique, unique par type. |
| `version` | entier ≥ 1 | Augmente à chaque modification : l'application retélécharge le contenu. |
| `name`, `description`, `author` | texte | Vitrine (60, 400 et 60 caractères au plus). |
| `price` | entier 0–5000 | Prix en flammes ; `0` = gratuit. |
| `status` | `draft` · `published` · `retired` | Seuls les contenus publiés sont diffusés ; un contenu retiré est annoncé dans `removed`. |
| `content` | JSON | Contenu, validé selon le type (voir plus bas). |
| `files` | liste | Fichiers associés : `name`, `url`, `sha256` (hexadécimal minuscule), `size` (octets, 15 Mo max), `mime`. |
| `created_at`, `updated_at`, `published_at` | dates | `updated_at` sert de curseur au catalogue. |

## Lecture publique (sans compte)

### `GET /v1/content/catalog`

Manifeste léger des contenus publiés, sans leur JSON.

Paramètres : `since` (date ISO 8601, changements postérieurs seulement), `type`,
`limit` (1–200, 100 par défaut), `offset`.

```json
{
  "schemaVersion": 1,
  "items": [{ "id": "…", "type": "theme_pack", "slug": "lagon", "version": 3, "name": "Lagon",
              "description": "…", "author": "PepsGoal", "price": 150, "size": 182344,
              "updatedAt": "2026-11-06T10:00:00.000Z", "publishedAt": "2026-11-01T09:00:00.000Z" }],
  "removed": ["…"],
  "cursor": "2026-11-06T10:00:00.000Z",
  "next": null
}
```

- Sans `since` : la liste complète ; tout contenu absent est à retirer du cache.
- Avec `since` : seulement ce qui a changé ; `removed` (première page) liste les
  contenus retirés depuis.
- `next` : `offset` de la page suivante, ou `null`. Le curseur à garder pour le
  prochain `since` est le plus grand `cursor` de toutes les pages.
- **ETag** fort sur le corps et `Cache-Control: public, max-age=300`. Renvoyer
  l'ETag dans `If-None-Match` : réponse `304` sans corps si rien n'a changé.
- 60 requêtes par minute et par adresse.

### `GET /v1/content/:id`

Contenu complet publié : les champs du catalogue, plus `status`, `content` et
`files`. ETag et `If-None-Match` comme ci-dessus (`max-age=3600`). `404` si le
contenu n'est pas (ou plus) publié. Pour un `theme_pack`, `content.id` vaut
l'`id` du contenu.

## Administration (rôle `admin`, jeton d'accès)

| Route | Effet |
| --- | --- |
| `GET /v1/admin/content?type=&status=` | Liste (500 derniers modifiés), tous statuts. |
| `GET /v1/admin/content/:id` | Détail. |
| `POST /v1/admin/content` | Création : `type`, `slug`, `name`, `description`, `author`, `price`, `content`, `files`, `status` (`draft` par défaut, ou `published`). `201`. |
| `PUT /v1/admin/content/:id` | Modification partielle (sauf `type`) ; `version` + 1. |
| `POST /v1/admin/content/:id/publish` | Publication (le contenu est revalidé). |
| `POST /v1/admin/content/:id/retire` | Retrait (gardé pour annoncer le retrait aux appareils). |
| `DELETE /v1/admin/content/:id` | Jamais publié : suppression définitive. Déjà publié : retrait. |
| `POST /v1/admin/content/media` | Téléversement d'une image (JPEG, PNG, WebP, 8 Mo) rangée sous son empreinte ; renvoie `name`, `url`, `sha256`, `size`, `mime`, à recopier dans `files`. |

Erreurs : `400 invalid` (corps ou contenu invalide, avec `issues`), `409
slug_taken`, `404 not_found`, `401`/`403` sans droits.

## Format d'un pack de thème (`theme_pack`, `schemaVersion` 1)

```json
{
  "schemaVersion": 1,
  "type": "theme_pack",
  "id": "perso-ab12cd34ef",
  "name": "Lagon",
  "emoji": "🏝️",
  "dark": false,
  "colors": {
    "bg": "#FFF7F0", "ink": "#2A1420", "surface": "#FFFFFF", "surface2": "#FFEDE1", "edge": "#F2DED1",
    "accent": ["#FFB000", "#FF4A12", "#FF3D96"],
    "deco": ["#FFE2CC", "#FFD6E8"]
  },
  "wallpaper": { "kind": "gradient", "colors": ["#7FD8FF", "#F7E3B5"] },
  "icon": "ocean",
  "fx": "bubbles",
  "author": "PepsGoal"
}
```

- `colors` : `#RRGGBB`. `bg` fond de l'écran, `ink` texte, `surface` cartes,
  `surface2` creux (rails, pastilles), `edge` bords et marches, `accent` les trois
  arrêts de la flamme, `deco` 1 à 4 couleurs décoratives du fond.
- `wallpaper.kind` :
  - `scene` + `key` : une scène illustrée de l'application (`nebula`, `loire`…) ;
  - `free` + `key` : fond gratuit (`pop`, `aurora`, `waves`, `stars`, `mesh`, `grid`, `plain`) ;
  - `gradient` + `colors` (2 à 4) : dégradé vertical ;
  - `image` + `file` : un fichier de `files` (obligatoire côté serveur ; dans un
    export d'application, l'image personnelle est remplacée par un dégradé).
- `icon` (clé d'une icône de la boutique) et `fx` (`snow`, `petals`, `leaves`,
  `hearts`, `embers`, `bubbles`, `confetti`, `stars`) sont facultatifs.
- Lisibilité : l'application vérifie un contraste d'au moins 4,5:1 (texte sur le
  fond, les cartes, les creux et la flamme) et propose une correction. Les packs
  publiés doivent le respecter.
- Une scène, une icône ou un effet ne s'appliquent que si l'utilisateur les
  possède déjà : un pack ne contourne pas la boutique.

### Versions

- Champs inconnus : tolérés (conservés par le serveur, ignorés par l'application).
  Une évolution compatible ajoute des champs sans changer `schemaVersion`.
- Changement incompatible : `schemaVersion` + 1. Le serveur n'accepte que les
  versions qu'il connaît ; l'application refuse un pack plus récent qu'elle et
  invite à la mettre à jour.

## Autres types

- `background` (version 1) : `{ "schemaVersion": 1, "type": "background", "file": "fond.jpg", "dark": false, "colors": ["#…"] }`.
- `sticker_pack`, `icon` : objet versionné (`schemaVersion`, `type`) au contenu
  encore libre ; l'application 9.2 les ignore.

## Comportement de l'application Android

- Relève du catalogue à l'ouverture de la boutique ou d'Apparence (au plus toutes
  les 15 minutes), et au plus une fois par jour en arrière-plan sur réseau non
  limité, batterie correcte (WorkManager). Aucune boucle.
- Requêtes conditionnelles (`If-None-Match`) ; catalogue, contenus et fichiers
  gardés dans `filesDir/content`. Un contenu n'est retéléchargé que si sa
  `version` change.
- Chaque fichier est vérifié (taille et sha256) avant usage ; chaque contenu est
  validé (`PackFormat`) : un contenu invalide est rejeté et n'apparaît pas.
- Hors ligne : le dernier catalogue en cache reste affiché ; les contenus déjà
  obtenus restent applicables.
- Achat : prix en flammes via le porte-monnaie habituel ; la possession est
  enregistrée dans les achats de l'utilisateur (`content:<id>@<prix>`), comme
  les autres articles, et synchronisée entre ses appareils.

## Boutique des créateurs et « PepsGoal Style » (10.0)

Chaque compte peut publier ses propres packs de thème (photo comprise) et fixer un prix en flammes (0 à 5000).
**100 % du prix revient au créateur.** Toutes les images sont calculées par le serveur, jamais par le téléphone :
la création d'un pack demande une connexion.

### PepsGoal Style

`POST /v1/style?stylize=1&weather=1&strength=0.8` (compte, multipart `file`, 10 Mo au plus, 20 par heure, deux calculs
à la fois sur le serveur, sinon `503 busy`).

- `stylize` : stylisation dans le style des fonds PepsGoal (lissage qui garde les bords, aplats par k-moyennes,
  couleurs rapprochées de la palette PepsGoal, ciel redessiné en dégradé, contours doux).
- `weather` : découpage du ciel. `foreground` est alors l'image sans le ciel (WebP avec transparence) : l'application
  dessine le ciel, la météo (pluie, neige, brouillard, nuit), puis ce premier plan par-dessus.
- Les deux options sont désactivables ; `strength` règle la force de la stylisation (0 à 1).

Réponse `201` : `{ image, foreground | null, colors: ["#RRGGBB"…], skyRatio, width, height, stylized, weather }`. `image`
et `foreground` sont des fichiers prêts à citer dans `files` (`name`, `url`, `sha256`, `size`, `mime`). Pas de ciel
trouvé (`skyRatio` < 4 %) : `foreground` est `null` et la météo est dessinée par-dessus toute l'image.

Dans un pack, le fond devient :

```json
"wallpaper": { "kind": "image", "file": "fond.jpg", "foreground": "premier-plan.webp", "weather": true, "styled": true }
```

### Publier

| Route | Rôle |
| --- | --- |
| `POST /v1/creator/media` | photo du pack (multipart `file`) rangée sous son empreinte |
| `POST /v1/creator/items` | `{ name, description, price, content, files }` : nouveau pack (`content` au format `theme_pack`) |
| `PUT /v1/creator/items/:id` | modification (nouvelle version) |
| `DELETE /v1/creator/items/:id` | retrait de la boutique (supprimé s'il n'a jamais été publié ni obtenu) |
| `GET /v1/creator/items` | mes packs : statut, `reviewNote`, `sales`, `earned` |
| `GET /v1/creator/sales?since=` | mes ventes `{ sales: [{ id, contentId, name, price, buyer, createdAt }], cursor, total, count }` |

- Les fichiers cités doivent être des médias de ce serveur (`/media/content/<sha256>.<ext>`, même taille sur le disque) :
  un créateur ne peut pas faire télécharger une adresse extérieure.
- L'auteur affiché est le nom du compte, jamais une valeur du corps. Le slug est tiré au hasard (`c-…`). 30 packs au plus.
- `CREATOR_REVIEW=true` (par défaut) : un nouveau pack est `pending` jusqu'à la validation de la modération ; une
  modification du nom, de la description ou des images le fait repasser en modération. `false` : publié tout de suite.
- Modération : `GET /v1/admin/content?status=pending`, `POST /v1/admin/content/:id/publish`,
  `POST /v1/admin/content/:id/reject` `{ reason }` (statut `rejected`, motif lu par le créateur, qui est prévenu).

### Acheter

`POST /v1/content/:id/purchase` (compte) : enregistre l'achat (ou l'obtention d'un contenu gratuit) une seule fois ;
rejouer la requête renvoie le même achat (`200`, `fresh: false`). Le porte-monnaie vit dans l'application : le
serveur vérifie un plafond (flammes gagnées + ventes − achats en ligne ≥ prix, sinon `402 insufficient`). Son propre
pack : `409 own_item`. Le créateur est prévenu (notification « +N flammes ») et son application crédite chaque vente
une seule fois (par son `id`). `GET /v1/me/content-purchases` rend la collection sur un nouvel appareil.

Le catalogue porte désormais `creatorId` (null : contenu officiel), `sales` et `preview` (adresse de l'image du fond).
