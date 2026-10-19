# PepsGoal — plateforme

Suivi d'objectifs avec flammes, séries, fonctions sociales et modération.
Ce dépôt contient le **serveur** (comptes, synchronisation, social, modération) et l'**application** (iOS, Android et web) qui fonctionne hors ligne.

```
pepsgoal-platform/
├── packages/shared/   Modèle de données, validation (zod), protocole de synchronisation, calcul des séries
├── apps/server/       API Node.js (Fastify + PostgreSQL)
├── apps/web-legacy/   Interface PepsGoal (celle de l'artefact) : tous les écrans, web et mobile
├── apps/web/          Couche connectée (cloud.js) et construction : version web + interface embarquée de l'app
├── apps/app/          App iOS / Android (Expo) : coque native qui embarque l'interface, hors ligne d'abord
└── docs/              Architecture, API, synchronisation, publication sur les stores, déploiement
```

## Démarrer en local

Prérequis : Node.js 20+, Docker (pour PostgreSQL), et l'app Expo Go sur un téléphone ou un simulateur pour l'app mobile.

```bash
npm install
```

```bash
docker compose up -d db
```

```bash
cp apps/server/.env.example apps/server/.env
```

```bash
npm run build -w packages/shared
```

```bash
npm run db:migrate
```

```bash
npm run dev:server
```

Version web, branchée sur le serveur local (ouvre ensuite http://localhost:8767) :

```bash
PEPSGOAL_API=http://localhost:8080 npm run build:web
```

```bash
npx serve apps/web/dist -l 8767
```

App mobile avec Expo Go (remplace l'adresse par celle de ton PC sur le réseau local) :

```bash
PEPSGOAL_API=http://192.168.1.10:8080 npm run dev:app
```

Sous PowerShell, définis la variable d'abord : `$env:PEPSGOAL_API="http://localhost:8080"`, puis lance la commande sans le préfixe.

L'interface se modifie dans `apps/web-legacy/pepsgoal.html` ; relance `npm run build:web` pour la voir dans la version connectée.

Au premier démarrage, le serveur crée le compte **PepsGoal Officiel** et le compte **admin**. En développement, le mot de passe admin est `password` (un avertissement s'affiche) ; en production, `ADMIN_BOOTSTRAP_PASSWORD` est obligatoire.

Version 2.1.5 : pastille J+1 et halo lumineux sur le récap de la période écoulée. Version 2.1.3 : récaps plus drôles, plus variés et plus animés, bilan de la période écoulée consultable jusqu'au lendemain. Version 2.1.2 : glissade de l'onglet sélectionné fluide pendant le chargement des données. Version 2.1.1 : ciel du thème Météo redessiné et allégé (correction du contenu invisible au changement de page sur certains téléphones), réglage du flou du verre givré. Version 2.1.0 : objectif « Période » (jours de la semaine ou du mois, sur une tranche horaire), météo de ta ville sur l'accueil, thèmes OLED et Météo (ciel en direct, verre givré), partage vers le feed, une story, un message ou une autre application, 12 nouvelles couleurs, 7 familles de badges, navigation à fond glissant et notifications plus rapides. Version 2.0.0 : réponses et réactions aux messages, mentions @ dans les groupes, suggestions d'amis (avec option pour ne pas y apparaître), objectifs favoris, étapes de projet réordonnables, nouveaux arrière-plans et image personnalisée avec extraction de ses couleurs, modes daltoniens par type et monochrome, anneau de niveau animé, micro-animations, onglet Serveur pour la modération, notes de version, easter eggs, et correction de la fiche objectif qui remontait en haut à chaque actualisation. Version 1.4.0 : notifications push (rappels du matin et du soir, messages, encouragements) même application fermée, mode hors ligne à la demande, encouragements dans les stories et archive personnelle des stories dans le profil, système de badges à paliers (Bronze → Diamant) avec animation, corrections visuelles. Version 1.3.0 : sondages dans le feed et la messagerie, sélecteur d'emojis par catégorie (plus de 700 emojis Fluent), synchronisation des clés de chiffrement fiabilisée, application sous licence MIT. Version 1.2.0 : messagerie chiffrée de bout en bout (photos, messages vocaux, objectifs, groupes) avec clés synchronisées entre appareils, photos dans les publications, blocage, e-mails de modération, emojis Fluent. Version 1.1.0 : mode hors ligne automatique, options d'accessibilité. Aucune donnée de démonstration côté serveur ; chaque installation démarre vide.

## Vérifications

```bash
npm run typecheck
```

```bash
npm test
```

Scénario de bout en bout (une quarantaine de vérifications : comptes, synchronisation, social, modération) contre un serveur de développement vierge :

```bash
node apps/server/test/e2e.mjs
```

Notes de version détaillées : [CHANGELOG.md](CHANGELOG.md), également consultables dans l'application (Paramètres › Aide › Notes de version).

## Documentation

| Document | Contenu |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Vue d'ensemble, choix techniques, modèle de données, sécurité, écrans à porter |
| [docs/SYNC.md](docs/SYNC.md) | Mode hors ligne, file d'attente, conflits, passage « sans compte » → compte |
| [docs/API.md](docs/API.md) | Liste des routes de l'API |
| [docs/STORES.md](docs/STORES.md) | Publication App Store / Google Play : checklist et exigences |
| [docs/E2E.md](docs/E2E.md) | Chiffrement de bout en bout des messages privés |
| [docs/GUIDE-HOSTINGER.md](docs/GUIDE-HOSTINGER.md) · [docs/GUIDE-WEB-HOSTINGER.md](docs/GUIDE-WEB-HOSTINGER.md) · [docs/GUIDE-STORES.md](docs/GUIDE-STORES.md) | Guides pas à pas : serveur sur Hostinger, version web (VPS ou hébergement web), publication sur les stores |
| [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md) | Mise en production du serveur, sauvegardes |

## Liens

- Site : https://site.pepsgoal.fr — application web : https://app.pepsgoal.fr
- Signaler un problème : https://github.com/CorbetQ/pepsgoal-platform/issues

## Licence

PepsGoal est un logiciel libre distribué sous [licence MIT](LICENSE) © 2026 Quentin CORBET.
Le nom PepsGoal et son logo ne sont pas concédés par la licence. Composants tiers : Fluent Emoji (MIT, Microsoft, voir `apps/web/emoji/LICENSE`), TweetNaCl (domaine public), JSZip (MIT), polices Unbounded et Manrope (SIL OFL 1.1).
