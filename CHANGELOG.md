# Notes de version

Ces notes sont aussi consultables dans l'application : Paramètres › Aide › Notes de version.

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
