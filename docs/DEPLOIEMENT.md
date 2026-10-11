# Déploiement du serveur

## Infrastructure conseillée

- **PostgreSQL 16 managé** avec sauvegardes automatiques quotidiennes et restauration à un instant donné.
- **Serveur** : l'image Docker (`apps/server/Dockerfile`) sur un hébergeur de conteneurs, derrière HTTPS (certificat automatique).
- **Images** : un volume persistant pour `MEDIA_DIR`, ou un stockage objet compatible S3 (à brancher dans `routes/account-misc.ts`) pour plusieurs instances.

## Nom de domaine : pepsgoal.fr

| Adresse | Rôle | Enregistrement DNS |
| --- | --- | --- |
| `pepsgoal.fr` | Site vitrine et pages légales publiques (`/cgu`, `/mentions-legales`, `/confidentialite`), exigées par les stores | vers l'hébergement du site |
| `api.pepsgoal.fr` | API de production (`EXPO_PUBLIC_API_URL` du profil `production` dans `apps/app/eas.json`) | vers le serveur de production (HTTPS obligatoire) |
| `staging-api.pepsgoal.fr` | API de test (profil `preview`) | vers le serveur de test |
| `app.pepsgoal.fr` | Version web de l'app (`apps/web/dist`, construite par `deploy/web-build.sh`), facultative | vers un hébergement statique avec repli sur `index.html` |

## Mise en production

1. Créer la base, puis appliquer les migrations : `DATABASE_URL=… npm run db:migrate`.
2. Renseigner les variables (voir `apps/server/.env.example`) :
   - `NODE_ENV=production`
   - `JWT_SECRET` : 48 caractères aléatoires minimum, gardé secret.
   - `ADMIN_BOOTSTRAP_PASSWORD` : obligatoire en production, 12 caractères minimum (compte `admin` créé au premier démarrage).
   - `PUBLIC_URL=https://api.pepsgoal.fr` (serveur de test : `https://staging-api.pepsgoal.fr`).
   - `CORS_ORIGINS=https://app.pepsgoal.fr` (version web de l'app).
   - `DB_PREPARE=false` si la base passe par PgBouncer en mode « transaction ».
3. Démarrer le conteneur ; vérifier `GET /v1/status`.
4. Se connecter avec `admin`, puis changer le mot de passe (`POST /v1/auth/password`).

## Données de démonstration

Depuis la version 1.0.0, le serveur ne contient aucune donnée de démonstration : une base neuve ne compte que les comptes `admin` et PepsGoal Officiel.
Le prototype web (`apps/web-legacy/pepsgoal.html`) garde un bouton « Mode démonstration » sur l'écran de connexion : il ouvre un bac à sable en mémoire, jamais enregistré et invisible des vrais comptes.

## Exploitation

- Tâches automatiques toutes les heures : stories expirées, notifications lues de plus de 90 jours, jetons et opérations de synchronisation périmés.
- Journaux au format JSON (les en-têtes d'authentification sont masqués).
- Maintenance : à programmer depuis la modération ; l'app l'affiche et passe les fonctions sociales en lecture seule (ou se met en pause en mode complet).
- Mise à jour du schéma : modifier `src/db/schema.ts`, puis `npm run db:generate` et `npm run db:migrate`.
