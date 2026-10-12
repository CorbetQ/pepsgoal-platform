# Site vitrine pepsgoal.fr

Le site public (accueil, fonctionnalités, design system, détails techniques, informations légales) est un site statique servi par Caddy depuis `deploy/site/`.
Il reprend le design system PepsGoal (verre givré sur halos vifs) avec plus de mouvement : halos qui dérivent, lueur qui suit le pointeur, apparitions au défilement, cartes inclinables, étincelles de validation. Tout mouvement est coupé avec `prefers-reduced-motion: reduce`, et le contenu reste lisible sans JavaScript.

| Fichier | Rôle |
| --- | --- |
| `pages/*.html` | Contenu de chaque page ; la première ligne `<!--meta title="…" description="…" nav="…"-->` donne le titre, la description et l'onglet actif |
| `partials/head.html`, `partials/foot.html` | En-tête (navigation, thème, menu mobile, bouton « Ouvrir l'app ») et pied de page communs |
| `tokens.json` | Copie des tokens du design system PepsGoal ; `ds-gen.mjs` en tire les nuanciers, contrastes, échelles typographiques, rayons et les huit thèmes de la page Design system |
| `build.mjs` | Assemble les pages dans `deploy/site/` |
| `deploy/site/assets/` | `site.css` (tokens et composants), `site.js` (comportements), `icons.svg` (icônes de l'app) |
| `deploy/site/fonts/`, `deploy/site/emoji/` | Unbounded et Manrope (latin), quelques emojis Fluent : aucun service tiers n'est contacté |

Après une modification dans `pages/`, `partials/` ou `tokens.json` :

```bash
node deploy/site-src/build.mjs
```

Les pages générées sont versionnées : `deploy/update.sh` les publie avec le reste (`git pull`), sans étape de construction sur le serveur.
Pour prévisualiser en local : `npx serve deploy/site`.
