# PepsGoal — plateforme

Suivi d'objectifs avec flammes, séries, fonctions sociales et modération.
Ce dépôt contient le **serveur** (comptes, synchronisation, social, modération) et l'**application** (iOS, Android et web) qui fonctionne hors ligne.

```
pepsgoal-platform/
├── packages/shared/   Modèle de données, validation (zod), protocole de synchronisation, calcul des séries
├── apps/server/       API Node.js (Fastify + PostgreSQL)
├── apps/app/          Application Expo (React Native) : iOS, Android et web, hors ligne d'abord
├── apps/web-legacy/   Prototype web d'origine (un seul fichier HTML), référence fonctionnelle et visuelle
└── docs/              Architecture, API, synchronisation, publication sur les stores, déploiement
```

## Démarrer en local

Prérequis : Node.js 20+, Docker (pour PostgreSQL), et l'app Expo Go sur un téléphone ou un simulateur.

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

```bash
npm run dev:app
```

Au premier démarrage, le serveur crée le compte **PepsGoal Officiel** et le compte **admin**. En développement, le mot de passe admin est `password` (un avertissement s'affiche) ; en production, `ADMIN_BOOTSTRAP_PASSWORD` est obligatoire.

Version 1.1.0 : messagerie chiffrée de bout en bout, mode hors ligne automatique, options d'accessibilité. Aucune donnée de démonstration côté serveur ; chaque installation démarre vide.

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

## Documentation

| Document | Contenu |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Vue d'ensemble, choix techniques, modèle de données, sécurité, écrans à porter |
| [docs/SYNC.md](docs/SYNC.md) | Mode hors ligne, file d'attente, conflits, passage « sans compte » → compte |
| [docs/API.md](docs/API.md) | Liste des routes de l'API |
| [docs/STORES.md](docs/STORES.md) | Publication App Store / Google Play : checklist et exigences |
| [docs/E2E.md](docs/E2E.md) | Chiffrement de bout en bout des messages privés |
| [docs/GUIDE-HOSTINGER.md](docs/GUIDE-HOSTINGER.md) · [docs/GUIDE-STORES.md](docs/GUIDE-STORES.md) | Guides pas à pas : serveur sur Hostinger, publication sur les stores |
| [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md) | Mise en production du serveur, sauvegardes |
