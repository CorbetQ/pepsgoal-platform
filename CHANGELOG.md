# Notes de version

Ces notes sont aussi consultables dans l'application : Paramètres › Aide › Notes de version.

## Serveur — mise à jour depuis Modération › Serveur (23 octobre 2026)

Utilisé par l'application Android 4.9.0 et la version web.
- `deploy/update.sh` annonce ses étapes (`::step n/total libellé`, `::done`) pour la barre de progression.
- `POST /v1/admin/update` `{ password, web }` (admin, 5 essais par 10 minutes) : l'API se connecte en SSH en root à la machine hôte avec ce mot de passe (jamais gardé ni journalisé), lance `update.sh` détaché (il survit au redémarrage de l'API) et renvoie `{ status: "started" | "busy" }`.
- `GET /v1/admin/update` : progression lue dans `deploy/logs/update.log` (monté en lecture seule dans le conteneur) : étape, pourcentage, dernières lignes, fin et code de sortie.
- `docker-compose.yml` : montage `./logs` et `host.docker.internal` pour le service `server`. Variables facultatives : `UPDATE_SSH_HOST`, `UPDATE_SSH_PORT`, `UPDATE_SSH_FINGERPRINT`, `UPDATE_SCRIPT`, `UPDATE_LOG`.
- Version web : carte « Mise à jour du serveur » dans Modération › Serveur.
- Mise en ligne : lancer une fois `/opt/pepsgoal/deploy/update.sh --web` à la main.

## Serveur — réactions sur les publications (22 octobre 2026)

Utilisé par l'application Android 4.1.0.
- Migration `0008_post_reactions` (appliquée au démarrage du conteneur) : colonne `reaction` sur `post_likes` (`fire` par défaut).
- `POST /v1/posts/:id/like` accepte un corps facultatif `{ "reaction": "fire" | "muscle" | "clap" | "party" }` (par défaut `fire`). Sur une publication déjà encouragée, seule la réaction change : pas de nouvelle notification ni de crédit de gel.
- Feed : chaque entrée de `likers` porte sa `reaction` ; chaque publication porte `myReaction` (ou `null`) et `reactions` (nombre par réaction).

## Serveur — mise à jour pour Android 4.0.0 (22 octobre 2026)

Regroupe les défis de la communauté (migration `0007_challenges`) et les ligues de la semaine ci-dessous.
- Aucune autre modification nécessaire pour Android 4.0.0 : la version mini d'une habitude envoie une validation de valeur 0,5 avec la moitié des points (entiers), déjà acceptée par la synchronisation ; les nouvelles options d'objectif (`mini`…) passent par les données libres de l'objectif.
- Mise en ligne sur le VPS : `/opt/pepsgoal/deploy/update.sh` (reconstruit l'API, applique la migration au démarrage, redémarre).

## Serveur — ligues de la semaine (22 octobre 2026)

Utilisé par l'application Android 3.9.0.
- `GET /v1/leagues/week?from=AAAA-MM-JJ` : flammes gagnées et jours actifs de la semaine (du lundi `from` au dimanche) pour soi et ses amis, du premier au dernier (comptes bannis exclus). Aucune migration.

## Serveur — défis de la communauté (22 octobre 2026)

Utilisé par l'application Android 3.5.0.
- Nouvelles tables `challenges`, `challenge_members` et `challenge_days` (migration `0007_challenges`, appliquée automatiquement au démarrage du conteneur).
- `GET /v1/challenges` : défis en cours, à venir et terminés depuis moins de 7 jours (participants, défi rejoint, jours validés).
- `GET /v1/challenges/:id` : détail et classement (50 premiers, comptes bannis exclus).
- `POST` / `DELETE /v1/challenges/:id/join` : rejoindre ou quitter un défi.
- `PUT` / `DELETE /v1/challenges/:id/days/:day` : valider ou annuler un jour (dans la période du défi, au plus tard le lendemain).
- Modération : `POST /v1/admin/challenges` (création) et `DELETE /v1/admin/challenges/:id`.

## 3.0.0 (21 octobre 2026) — application Android native

L'application Android est réécrite en natif (Kotlin, Jetpack Compose) dans le dépôt [pepsgoal-android](https://github.com/CorbetQ/pepsgoal-android) : elle n'embarque plus l'interface web.

### Nouveautés Android
- Interface entièrement native : accueil, 15 types d'objectifs, feed, stories, amis, messagerie chiffrée de bout en bout (photos, vocaux, sondages, réactions, mentions), profil, récaps, badges, réglages et modération.
- Material You : Paramètres › Apparence › « Couleurs Material You » applique les couleurs du fond d'écran à toute l'interface.
- Activités en cours (Live Updates d'Android 16) : minuteur, période en cours et fin de journée quand la série est en jeu, dans la barre d'état, l'écran de verrouillage et la Now Bar.
- Notifications enrichies : valider depuis un rappel, confirmer la validation d'un ami, répondre à un message ou le marquer comme lu sans ouvrir l'application.
- Rappels à l'heure exacte, synchronisation en arrière-plan, widget « Ta journée », raccourcis d'application et icône thématique.

## 2.1.6 (19 octobre 2026)

### Corrections
- Récap J+1 : le reflet lumineux sautait à chaque boucle. Il glisse désormais par une transformation (exécutée par le compositeur) et part comme il arrive hors de la carte : la boucle redémarre sans saut visible.

### Apparence
- Verre givré : nouveau niveau « Très faible » (flou minimal, panneaux presque opaques), dans tous les thèmes.
- Accueil : la carte « En cours » peut être masquée, avec un bouton sur la carte ou dans Paramètres › Apparence (réglage synchronisé avec le compte).

## 2.1.5 (19 octobre 2026)

### Récaps
- Correction : la mention du bilan J+1 débordait de sa carte et le titre « Semaine passée » sortait du cadre. La mention devient une petite pastille « J+1 » dans le coin, le titre s'adapte à la largeur de la carte, et le mois ou l'année concernés s'affichent en sous-titre (« Octobre · bilan complet, aujourd'hui »).
- Le récap disponible le lendemain d'une période s'entoure d'un halo lumineux qui respire, avec un reflet qui passe.

## 2.1.3 (19 octobre 2026)

### Récaps
- Nouvelles diapositives : comparaison avec la période précédente, jour fétiche en graphique, créneau préféré, « Le saviez-vous ? » (heures cumulées, kilomètres, validation la plus matinale ou la plus tardive, étapes de projet), trophées humoristiques (Jour de gloire, Prix du coq, Prix de la chauve-souris, Prix de la sieste…).
- Plus d'humour et de diversité : plusieurs phrases possibles pour chaque statistique, tirées au sort de façon stable pour une même période ; nouveaux profils (Machine suisse, Phénix, Ninja de minuit, Guerrier du week-end, Collectionneur…).
- Plus d'animations : glissement entre les diapositives, fond animé, emojis flottants, jours qui s'allument un à un, barres qui poussent, trophées qui apparaissent, confettis sur la dernière diapositive (tout est désactivé avec « Désactiver les animations »).
- Le récap d'une semaine, d'un mois ou d'une année terminés reste affiché le lendemain (J+1), avec une notification « récap prêt », avant de laisser place au récap suivant.

## 2.1.2 (19 octobre 2026)

### Corrections
- Barre de navigation : le fond de l'onglet sélectionné ne se téléporte plus quand la page se reconstruit après l'arrivée des données de l'API (Feed, Amis). La glissade démarre dès le toucher, tourne sur le compositeur (Web Animations) et reprend exactement là où elle en était après chaque reconstruction.

## 2.1.1 (19 octobre 2026)

### Corrections
- Changement de page avec le thème Météo : le contenu pouvait rester invisible sur certains téléphones (Chrome Android). Le ciel n'est plus fait de dizaines d'éléments animés et floutés, qui saturaient la mémoire graphique, mais d'un seul canevas.
- La transition de page ne masque plus jamais le contenu (elle part de 40 % d'opacité) et est désactivée avec le thème Météo.

### Thème Météo
- Ciel redessiné : nuages en relief sur trois profondeurs, soleil avec halo et rayons, lune avec cratères, étoiles scintillantes et étoiles filantes, pluie selon l'intensité, neige qui virevolte, éclairs, brouillard, ciel plus gris par temps de neige.
- 30 images par seconde au plus, pause quand l'application est en arrière-plan, image fixe si les animations sont désactivées.

### Apparence
- Nouveau réglage « Flou du verre givré » : faible, moyen (par défaut) ou fort, synchronisé avec le compte.

## 2.1.0 (19 octobre 2026)

### Objectifs
- Nouveau type « Période » : hebdomadaire (certains jours de la semaine) ou mensuelle (certains jours du mois ; le 29, 30 ou 31 tombe le dernier jour des mois plus courts), sur une tranche horaire précise. Validation pendant la tranche ou dans l'heure qui suit, rappel au début de chaque période, prochaines périodes dans la fiche.

### Météo
- Choix de la ville dans Paramètres › Météo (recherche par nom).
- Carte météo sur l'accueil, sous « Ta journée » : température, ressenti, minimum et maximum, vent, risque de pluie, trois jours de prévisions, lever et coucher du soleil, et un conseil selon le temps.
- Données Open-Meteo ; avec un compte, les demandes passent par le serveur PepsGoal (cache de 10 minutes, l'adresse IP des utilisateurs n'est pas transmise).

### Apparence
- Thème OLED (noir pur).
- Thème Météo : ciel en direct qui suit l'heure (aube, jour, crépuscule, nuit) et le temps de la ville (soleil, lune et étoiles, nuages, pluie, neige, orage, brouillard), panneaux en verre givré ; le choix d'arrière-plan est alors désactivé.
- 12 nouvelles couleurs d'accent (24 au total).
- Navigation : le fond de l'onglet sélectionné glisse d'un onglet à l'autre (barre du bas et barre latérale).

### Partage
- Nouveau panneau de partage : Feed, Story (progression d'un objectif ou récap), Message (ami ou groupe, chiffré de bout en bout) et Externe (applications de l'appareil, ou copie du texte).

### Badges
- 7 nouvelles familles : Lève-tôt, Oiseau de nuit, Week-end actif, Ponctuel, Bâtisseur, Conteur, Plume. Les paliers déjà mérités sont ajoutés sans célébration à la mise à jour.

### Notifications
- Rappels vérifiés chaque minute par le serveur (au lieu de cinq).
- Messages, mentions et rappels envoyés en priorité haute, avec une durée de validité adaptée.
- Application ouverte : la notification s'affiche aussitôt et les données sont relues sans attendre ; une notification reçue pendant une actualisation en déclenche une nouvelle.
- Retour sur l'application : rappels et météo vérifiés immédiatement.

### Corrections
- L'icône des onglets ne saute plus en changeant de page.
- Alignement de l'icône de profil et de son anneau de niveau.
- Réactions : un bouton « − » referme les emojis supplémentaires.
- Déploiement : `update.sh` et `web-build.sh` remettent `package-lock.json` comme sur GitHub (le `git pull` ne bloque plus).

### Technique
- API : `GET /v1/weather/places`, `GET /v1/weather` ; type d'objectif `period` ; thèmes `oled` et `weather`.
- Aucune migration de base de données.

## 2.0.0 (16 octobre 2026)

### Messagerie
- Répondre à un message précis (citation cliquable qui ramène au message d'origine).
- Réagir avec des emojis (7 réactions rapides et 18 autres) ; toucher une réaction existante l'ajoute ou la retire.
- Mentions `@nom` dans les groupes, avec une liste des membres pendant la saisie ; les membres mentionnés reçoivent une notification.
- Réponses et réactions sont chiffrées de bout en bout comme les messages ; les réactions ne déclenchent pas de notification push.
- Le texte explicatif sur le chiffrement n'est plus affiché en permanence : il s'ouvre avec le bouton cadenas de la conversation.

### Social
- Suggestions d'amis : amis de tes amis (classés par amis en commun), membres de tes groupes, puis nouveaux inscrits. Chaque suggestion peut être masquée.
- Nouveau réglage « Apparaître dans les suggestions d'amis » (Paramètres › Social et confidentialité).

### Objectifs
- Objectifs favoris : étoile dans la fiche, favoris en tête des listes et filtre « Favoris ».
- Projets : étapes réordonnables par glisser-déposer ou avec les flèches (accessibles au clavier).
- Correction : la fiche d'un objectif ne remonte plus en haut à chaque actualisation automatique (la position de lecture et le focus sont conservés).

### Apparence
- Nouveaux arrière-plans : Aurore, Vagues, Constellation, Dégradé, Grille et Uni, en plus de Blob.
- Image d'arrière-plan personnalisée (gardée sur l'appareil) et extraction de ses couleurs principales, utilisables comme couleur d'accent.
- Anneau animé autour de l'icône de profil, qui évolue avec le niveau (de l'Étincelle à la Supernova).
- Micro-animations dans toute l'interface : boutons, onglets, interrupteurs, cartes, réactions, menus. Elles respectent « Désactiver les animations » et le réglage du système.
- Quelques surprises cachées dans les couleurs d'accent, et une autre le 1er avril.

### Accessibilité
- Mode daltonien par type : deutéranopie, protanopie, tritanopie.
- Mode monochrome (niveaux de gris).
- Contraste élevé sans aucun dégradé (surfaces pleines, texte et bordures nets).

### Modération
- Nouvel onglet « Serveur » : version, durée de fonctionnement, mémoire, charge, trafic (requêtes, erreurs, temps de réponse, requêtes par minute), volumes de la communauté et des contenus, stockage, activité des 14 derniers jours ; actualisation toutes les 30 secondes.

### Aide
- Notes de version consultables dans l'application.

### Technique
- API : `GET /v1/friends/suggestions`, `GET /v1/admin/stats`, champs `silent` et `mentions` à l'envoi d'un message, notification `mention`.
- Aucune migration de base de données.

## 1.4.0 (16 octobre 2026)
- Notifications push sur la version web (rappels du matin et du soir, messages, encouragements), même application fermée.
- Mode hors ligne à la demande.
- Encouragements sur les stories et archive personnelle des stories dans le profil.
- Badges à paliers (Bronze à Diamant) avec animation de déblocage.
- Corrections visuelles.

## 1.3.0 (14 octobre 2026)
- Sondages dans le feed et dans la messagerie ; sélecteur d'emojis par catégorie.
- Liens d'aide (site, code source, signalement) ; licence MIT.
- Synchronisation des clés de chiffrement fiabilisée.

## 1.2.0 (12 octobre 2026)
- Messagerie chiffrée de bout en bout (photos, messages vocaux, objectifs partagés, groupes).
- Photos dans les publications, blocage, e-mails de modération, emojis Fluent.

## 1.1.0 (11 octobre 2026)
- Mode hors ligne automatique et options d'accessibilité.

## 1.0.0 (10 octobre 2026)
- Première version.
