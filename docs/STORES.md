# Publication sur l'App Store et Google Play

Les builds et l'envoi aux stores passent par **EAS** (service d'Expo) : `npm run build:ios -w apps/app`, puis `npm run submit:ios -w apps/app` (idem `android`).

## À préparer

| Élément | Où | État |
| --- | --- | --- |
| Compte Apple Developer (99 $/an) et compte Google Play Console (25 $ une fois) | — | à créer |
| Identifiants de l'app : `fr.pepsgoal.app` (iOS et Android, d'après le domaine pepsgoal.fr) | `apps/app/app.json` | fait (définitif après la première publication) |
| Icône 1024×1024, écran de démarrage, icône adaptative Android, favicon | `apps/app/assets/` + `app.json` (`icon`, `splash`, `android.adaptiveIcon`, `web.favicon`) | fait (flamme PepsGoal) |
| Adresse de l'API de production | `apps/app/eas.json` (`EXPO_PUBLIC_API_URL`), sinon celle du build web (`PEPSGOAL_API`) | `https://api.pepsgoal.fr` (test : `https://staging-api.pepsgoal.fr`) |
| Identifiant App Store Connect | — | automatique : `eas submit` retrouve ou crée la fiche App Store à partir de l'identifiant de l'app (connexion avec l'identifiant Apple) |
| Captures d'écran (6,7" et 5,5" iPhone, téléphone Android, tablette si prise en charge) | consoles des stores | à produire |
| Pages publiques : CGU, mentions légales, charte de confidentialité (URL accessibles sans compte) | site web | textes prêts (éditeur : Quentin CORBET, Angers, quentin-corbet@outlook.fr), à publier sur `https://pepsgoal.fr/cgu`, `/mentions-legales` et `/confidentialite` |
| URL d'assistance et site marketing demandés par les stores | consoles des stores | `https://pepsgoal.fr` (contact : quentin-corbet@outlook.fr) |
| Compte de test pour la revue (identifiant + mot de passe) | consoles des stores | à créer sur le serveur de production |

## Exigences des stores déjà couvertes

- **Suppression du compte depuis l'app** (Apple 5.1.1(v), Google) : `DELETE /v1/me`, à relier à l'écran Paramètres › Compte lors du portage.
- **Contenus d'utilisateurs** (Apple 1.2, Google « UGC ») : signalement des publications, blocage des comptes, modération avec suppression et sanctions, CGU acceptées à l'inscription.
- **Utilisation sans compte** : l'app fonctionne entièrement sans compte (Apple 5.1.1 recommande de ne pas imposer de compte pour les fonctions qui n'en ont pas besoin).
- **Chiffrement** : uniquement HTTPS standard → `ITSAppUsesNonExemptEncryption: false` déjà déclaré.
- **Permissions** : aucune permission demandée pour l'instant. À l'ajout des photos (stories) et des rappels, ajouter les textes d'usage (`NSPhotoLibraryUsageDescription`, notifications).

## Déclarations de confidentialité

**Apple « App Privacy » / Google « Sécurité des données »** — données collectées, toutes liées au compte, non utilisées pour le suivi publicitaire :
- Identifiants : nom d'utilisateur, identifiant de compte.
- Contenus de l'utilisateur : objectifs et progression, publications, commentaires, photos (stories, avatar). Les messages privés sont chiffrés de bout en bout : illisibles par l'éditeur, ils n'ont pas à être déclarés comme données collectées (règle Apple et Google pour le chiffrement de bout en bout).
- Données d'usage : aucune mesure d'audience.
- Données de diagnostic : aucune (à mettre à jour si un outil de rapport de plantage est ajouté).

Mode sans compte : aucune donnée ne quitte l'appareil.

## Avant chaque version

1. Incrémenter `version` dans `app.json` (actuellement 1.3.0) (le numéro de build est géré automatiquement par EAS).
2. Si l'API change de façon incompatible, augmenter `MIN_APP_VERSION` côté serveur pour inviter à mettre à jour.
3. Tester hors ligne : mode avion, valider des objectifs, réactiver le réseau, vérifier la synchronisation.
