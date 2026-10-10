# Synchronisation et mode hors ligne

## Écriture

Chaque action (créer un objectif, valider une journée, changer un réglage) :
1. est écrite **immédiatement** dans la base locale (l'écran se met à jour sans attendre le réseau) ;
2. ajoute une **opération** dans la file d'attente locale (`outbox`) :

```json
{ "opId": "uuid unique", "entity": "goal | checkin | goalGroup | settings", "action": "upsert | delete",
  "id": "identifiant de l'élément", "data": { … }, "clientUpdatedAt": "2026-10-10T08:15:00.000Z" }
```

Les identifiants sont des UUID générés par l'appareil : un objectif créé hors ligne garde le même identifiant sur le serveur.

## Envoi et réception

Quand l'appareil est en ligne (compte connecté, internet disponible, serveur joignable) :

1. **Envoi** : `POST /v1/sync/push` par lots de 100 opérations.
   - Chaque opération est appliquée dans sa propre transaction.
   - Une opération déjà reçue (même `opId`) n'est jamais appliquée deux fois : renvoyer la file après une coupure est sans danger.
   - Réponse : `applied` (appliquées ou déjà reçues) et `rejected` (avec la raison). Les deux sont retirées de la file : en cas de refus, c'est la version du serveur qui sera récupérée à l'étape suivante.
2. **Réception** : `GET /v1/sync/pull?cursor=N` renvoie tout ce qui a changé depuis la révision `N` (objectifs, validations, groupes, réglages, suppressions), par pages de 500. Le curseur n'est enregistré qu'après application.

Déclencheurs : démarrage de l'app, retour de la connexion, retour au premier plan, toutes les 60 secondes, bouton « Synchroniser maintenant ».

## Conflits

Règle unique, partagée par le serveur et l'app (`resolveLww` dans `packages/shared`) : **la modification la plus récente gagne**.
- Le serveur refuse une opération plus ancienne que sa version (`stale`).
- L'app n'écrase pas une modification locale plus récente encore dans la file.
- Une horloge d'appareil en avance est ramenée à « maintenant + 5 minutes » pour ne pas bloquer les autres appareils.

Raisons de refus possibles : `stale` (plus ancienne), `forbidden` (objectif d'un autre), `invalid` (données non conformes), `not_found` (objectif supprimé).

## Mode hors ligne

La connexion est surveillée en continu (NetInfo + `GET /v1/status` toutes les 30 secondes). Hors ligne :
- tout ce qui concerne les objectifs reste disponible (lecture, création, validation, séries) ;
- les onglets **Feed** et **Amis** sont masqués et un bandeau l'explique ;
- les modifications s'accumulent dans la file et partent automatiquement au retour de la connexion.

La déconnexion d'un compte est refusée tant que des modifications ne sont pas envoyées, pour ne rien perdre ;
après déconnexion, la base locale est vidée (les données restent sur le serveur).

## Sans compte → compte

En mode sans compte, l'appareil utilise un identifiant local. À la création d'un compte (ou à la connexion) :
1. toutes les données locales sont réattribuées au nouvel identifiant ;
2. chaque objectif et chaque validation est ajouté à la file ;
3. la première synchronisation envoie tout au serveur.

## Limites connues

- Les fonctions sociales ne sont pas mises en cache hors ligne (choix volontaire : contenus d'autres personnes, modération).
- Un membre retiré d'un défi de groupe ne reçoit pas de suppression : l'objectif reste chez lui jusqu'à la prochaine réinstallation.
- Les bonus de points (paliers) sont calculés par l'app et plafonnés par le serveur ; un calcul entièrement côté serveur est à prévoir si un classement public est ajouté.
