# Site vitrine pepsgoal.fr

Le site public (accueil, fonctionnalités, design system, détails techniques, informations légales, CGU, mentions légales, confidentialité, licence MIT, notes de version, page 404) est un site statique servi par Caddy depuis `deploy/site/`.
Il reprend le design system PepsGoal (verre givré sur halos vifs) avec plus de mouvement : halos qui dérivent, lueur qui suit le pointeur, apparitions au défilement, cartes inclinables, étincelles de validation. Tout mouvement est coupé avec `prefers-reduced-motion: reduce`, et le contenu reste lisible sans JavaScript.

| Fichier | Rôle |
| --- | --- |
| `pages/*.html` | Contenu de chaque page ; la première ligne `<!--meta title="…" description="…" nav="…"-->` donne le titre, la description et l'onglet actif |
| `partials/head.html`, `partials/foot.html` | En-tête (navigation, thème, menu mobile, bouton « Ouvrir l'app ») et pied de page communs |
| `icons.mjs`, `icons-extra.svg` | Sprite `assets/icons.svg` : toutes les icônes de l'application (constante `P` de `apps/web-legacy/pepsgoal.html`) plus celles propres au site |
| `emoji-gen.mjs` | Échantillon du sélecteur d'emojis de l'application (constante `EMOJI_CATS`) : 12 emojis par catégorie, images Fluent copiées depuis `apps/web/emoji` |
| `changelog-gen.mjs` | Notes de version lues dans `CHANGELOG.md` : frise de la page Technique et page `notes-de-version.html` |
| `tokens.json` | Copie des tokens du design system PepsGoal ; `ds-gen.mjs` en tire les nuanciers, contrastes, échelles typographiques, rayons et les huit thèmes de la page Design system |
| `build.mjs` | Assemble les pages dans `deploy/site/` et applique la typographie française (espaces insécables, apostrophes) au texte affiché ; génère aussi `cgu.html`, `mentions-legales.html` et `confidentialite.html` à partir des textes légaux de l'application (`apps/web-legacy/pepsgoal.html`) |
| `hostinger/.htaccess` | Réglages pour un hébergement mutualisé (LiteSpeed / Apache) : HTTPS, adresses courtes, page 404, cache, en-têtes de sécurité |
| `zip-hostinger.sh` | Construit le site et l'emballe avec le `.htaccess` dans un zip à extraire dans `public_html` |
| `deploy/site/assets/` | `site.css` (tokens et composants), `site.js` (comportements), `icons.svg` (icônes de l'app) |
| `deploy/site/fonts/`, `deploy/site/emoji/` | Unbounded et Manrope (latin), quelques emojis Fluent : aucun service tiers n'est contacté |

Après une modification dans `pages/`, `partials/` ou `tokens.json` :

```bash
node deploy/site-src/build.mjs
```

Les pages générées sont versionnées : `deploy/update.sh` les publie avec le reste (`git pull`), sans étape de construction sur le serveur.
Pour prévisualiser en local : `npx serve deploy/site`.

## Hébergement web mutualisé Hostinger

```bash
sh deploy/site-src/zip-hostinger.sh
```

Le fichier `deploy/pepsgoal-site-hostinger.zip` (non versionné) s'envoie depuis hPanel › Fichiers › Gestionnaire de fichiers : ouvrir `public_html`, téléverser le zip, puis « Extraire » directement dans `public_html` (le `index.html` doit se trouver à la racine de `public_html`, pas dans un sous-dossier).

Le numéro de version affiché (`{{VERSION}}`), la date des textes légaux (`{{LEGAL_UPDATED}}`), les textes légaux et les notes de version (`CHANGELOG.md`) sont lus dans le dépôt à chaque construction ; les emojis Fluent cités par les pages sont copiés depuis `apps/web/emoji` : après une mise à jour de l'application, il suffit de relancer `node deploy/site-src/build.mjs`.
