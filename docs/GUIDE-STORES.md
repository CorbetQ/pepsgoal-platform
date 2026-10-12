# Compiler PepsGoal et le publier sur l'App Store et Google Play

La compilation se fait dans le cloud avec **EAS** (Expo) : pas besoin de Mac ni d'Android Studio. Prérequis : le serveur est en ligne (`https://api.pepsgoal.fr`, voir GUIDE-HOSTINGER.md) et les pages légales sont publiées sur pepsgoal.fr.

L'app mobile est une coque native (`apps/app/App.tsx`) qui embarque l'interface PepsGoal, la même que l'artefact et que `app.pepsgoal.fr`.
L'interface est intégrée à l'app (et non chargée depuis internet) : elle s'ouvre instantanément et fonctionne hors ligne.
EAS la reconstruit automatiquement à chaque compilation (script `eas-build-post-install`, qui lance `apps/web/build.mjs`).

## 1. Comptes à créer

| Compte | Coût | Remarques |
| --- | --- | --- |
| Expo (expo.dev) | gratuit (offre gratuite suffisante pour démarrer) | compile les apps |
| Apple Developer Program, en tant que **particulier** | 99 $/an | vérification d'identité, compte sous le nom « Quentin CORBET » |
| Google Play Console, compte **personnel** | 25 $ une fois | vérification d'identité ; voir l'étape 5 pour la règle des 12 testeurs |

## 2. Préparer le projet (une fois)

```bash
npm install -g eas-cli
eas login
cd pepsgoal-platform/apps/app
eas init
```
`eas init` ajoute l'identifiant du projet dans `app.json`. Valide ce changement dans git.
L'identifiant de l'app est `fr.pepsgoal.app` (iOS et Android) et devient définitif à la première publication.
Pour essayer l'app sur ton téléphone avant tout, lance `eas build --platform android --profile preview` et installe l'APK obtenu.
Pour l'essayer pendant le développement avec Expo Go : `npm run start -w apps/app`, puis scanne le QR code (l'API utilisée est celle du build web : `PEPSGOAL_API=http://IP-DE-TON-PC:8080 npm run webapp -w apps/app` pour un serveur local).

## 3. Compiler

```bash
cd pepsgoal-platform/apps/app
npm run build:android
npm run build:ios
```
- Le profil `production` (fichier `eas.json`, variable `EXPO_PUBLIC_API_URL`) utilise `https://api.pepsgoal.fr` et augmente automatiquement le numéro de build.
- Android : à la première compilation, accepte qu'EAS génère la **clé de signature** ; il la conserve pour toi.
- iOS : EAS te demande ton identifiant Apple et crée seul les certificats et profils.
- Chaque compilation prend de 10 à 30 minutes ; le lien de téléchargement apparaît sur expo.dev.

## 4. App Store (iOS)

1. Envoie la compilation : `npm run submit:ios`. EAS crée la fiche dans App Store Connect si elle n'existe pas, puis envoie le build. Il apparaît dans TestFlight après environ 15 minutes de traitement.
2. Dans App Store Connect › ton app, renseigne :
   - **Informations** : nom PepsGoal, sous-titre (ex. « Objectifs, routines et séries »), catégorie Santé et forme (ou Productivité).
   - **URL de confidentialité** : `https://pepsgoal.fr/confidentialite`. **URL d'assistance** : `https://pepsgoal.fr`.
   - **Confidentialité de l'app** : données collectées, toutes liées à l'identité de l'utilisateur et aucune utilisée pour le suivi :
     - identifiants (nom d'utilisateur) ;
     - contenu utilisateur (objectifs, publications, photos des publications). Les messages privés et de groupe (texte, photos, messages vocaux), chiffrés de bout en bout et illisibles par l'éditeur, n'ont pas à être déclarés.
   - **Autorisations** : micro (messages vocaux), photos et appareil photo (profil, publications, stories). Les textes d'explication sont dans `apps/app/app.json`.
   - **Classification par âge** : réponds au questionnaire en signalant les contenus générés par les utilisateurs et la messagerie.
   - **Statut de commerçant (DSA, Union européenne)** : déclare-toi *non-commerçant* (particulier, app gratuite, aucune activité commerciale).
   - **Captures d'écran** : au minimum iPhone 6,9" (1320 × 2868) ; ajoute iPad si tu laisses la prise en charge des tablettes (`supportsTablet` dans app.json).
   - **Informations pour la vérification** : crée un compte de test sur le serveur de production (ex. `revue.apple`) avec quelques objectifs, et donne son identifiant et son mot de passe. Précise dans les notes que l'app fonctionne aussi sans compte.
3. Choisis le build, puis **Soumettre pour vérification** (en général 24 à 48 h).

Points déjà couverts par l'app :
- suppression du compte depuis Profil ;
- signalement et blocage, modération ;
- utilisation sans compte ;
- liens vers les CGU et la confidentialité ;
- chiffrement standard uniquement, déjà déclaré ;
- fonctionnement hors ligne, interface embarquée dans l'app, partage natif des exports (règle 4.2 d'Apple sur les apps qui se contentent d'afficher un site : PepsGoal n'en est pas une, mais mentionne-le dans les notes de vérification si besoin).

## 5. Google Play (Android)

1. Play Console › **Créer une application** : nom PepsGoal, français, application, gratuite.
2. **Contenu de l'application**, à remplir entièrement :
   - politique de confidentialité (`https://pepsgoal.fr/confidentialite`) ;
   - accès à l'app : identifiants du compte de test ;
   - annonces : non ;
   - classification du contenu : questionnaire IARC, en signalant les interactions entre utilisateurs ;
   - public cible : 16 ans et plus recommandé ;
   - **Sécurité des données** : mêmes données que pour Apple, chiffrées en transit, suppression possible depuis l'app ou par e-mail ; messagerie chiffrée de bout en bout.
3. **Fiche Play Store** :
   - icône 512 × 512 : redimensionne `apps/app/assets/icon.png` ;
   - image de présentation 1024 × 500 ;
   - au moins 2 captures d'écran de téléphone ;
   - descriptions courte et complète.
4. **Premier envoi, à faire à la main** (limite de l'API Google) :
   - télécharge le fichier `.aab` depuis expo.dev ;
   - Play Console › Tests › **Test fermé** › créer une version › importe le `.aab`.
5. **Règle des comptes personnels récents** : avant de pouvoir publier en production, un test fermé doit tourner avec **au moins 12 testeurs inscrits pendant 14 jours consécutifs**.
   - Ajoute leurs adresses Gmail dans une liste de testeurs et envoie-leur le lien d'inscription.
   - Prévois-en 15 à 20, car si l'on passe sous 12 le décompte peut repartir de zéro.
   - Ensuite : Tableau de bord › **Demander l'accès à la production**.
6. Envois suivants, automatisés :
   - Google Cloud › crée un **compte de service** et télécharge sa clé JSON ;
   - Play Console › Utilisateurs et autorisations › invite ce compte avec les droits de publication ;
   - expo.dev › ton projet › Credentials › Android › **Add a Google Service Account Key** ;
   - puis `npm run submit:android`, qui envoie par défaut sur le canal de test interne (voir `eas.json`), et passe la version en production depuis Play Console.

Garde la clé JSON comme un mot de passe : jamais dans git.

## 6. Publier une mise à jour

1. Augmente `version` dans `apps/app/app.json` (ex. 1.1.1) : elle est reprise par l'interface au moment de la construction.
2. `npm run build:android && npm run build:ios`, puis `npm run submit:android` et `npm run submit:ios`.
3. Soumets les nouvelles versions dans les deux consoles.
4. Si l'API change de façon incompatible, déploie d'abord le serveur, puis augmente `MIN_APP_VERSION` dans `deploy/.env` une fois la nouvelle app disponible.

## Liste de contrôle avant la première soumission

- [ ] `https://api.pepsgoal.fr/v1/status` répond
- [ ] Pages `/cgu`, `/mentions-legales` et `/confidentialite` en ligne
- [ ] Mot de passe `admin` changé
- [ ] Compte de test créé sur le serveur de production
- [ ] Testé hors ligne sur un vrai téléphone : mode avion, valider un objectif, réactiver le réseau, vérifier la synchronisation
- [ ] Android : bouton retour (ferme la fenêtre ouverte, revient à « Jour », puis quitte) ; export .zip proposé dans la feuille de partage
- [ ] Captures d'écran prêtes
