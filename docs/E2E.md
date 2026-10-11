# Chiffrement de bout en bout des messages privés

Depuis la version 1.1.0, les messages entre amis sont chiffrés sur l'appareil avant l'envoi. Le serveur stocke uniquement des données chiffrées et ne peut pas les lire. L'éditeur, l'hébergeur et la modération ne le peuvent pas non plus.
Seuls les messages du compte PepsGoal Officiel (annonces et modération) circulent en clair.

## Principe

| Élément | Où il vit | Rôle |
| --- | --- | --- |
| Paire de clés X25519 de l'appareil | Secrète : stockage local de l'app sur l'appareil (`pepsgoal.e2e.v1`), jamais envoyée. Publique : serveur (`e2e_devices`) | Recevoir des clés de conversation |
| Clé de paire (32 octets aléatoires) | Stockage local des appareils des deux amis uniquement | Chiffrer les messages d'une paire d'amis |
| Enveloppe | Serveur (`e2e_envelopes`) | Clé de paire chiffrée pour **un** appareil (`crypto_box`), illisible par les autres |
| Message | Serveur (`messages.e2e`) | `crypto_secretbox` (XSalsa20-Poly1305) du texte avec la clé de paire |

Primitives : [tweetnacl](https://github.com/dchest/tweetnacl-js), une implémentation auditée de NaCl, intégrée à l'app par `apps/web/build.mjs` et utilisée par `apps/web/src/cloud.js` (le serveur et ses tests utilisent les mêmes formats, `packages/shared/src/e2e.ts`). L'aléa vient de `crypto.getRandomValues`.

## Déroulé

1. **Connexion** : l'appareil génère sa paire de clés et publie sa clé publique (`POST /v1/e2e/devices`).
2. **Première conversation** : le premier ami qui ouvre la conversation tire une clé de paire. Il la chiffre pour chaque appareil des deux comptes et dépose les enveloppes (`POST /v1/e2e/peers/:id/keys`).
3. **Envoi** : le texte est chiffré avec la clé de paire et le serveur reçoit `{ v, keyId, nonce, ct }`. Il vérifie seulement que `keyId` appartient à cette paire d'amis, et refuse tout message en clair.
4. **Nouvel appareil ou reconnexion** : après chaque synchronisation, l'app demande `GET /v1/e2e/pending` et re-chiffre les clés qu'elle détient pour les appareils qui ne les ont pas encore. Cela vaut pour ses propres appareils comme pour ceux de l'ami : c'est ainsi que la clé se **synchronise entre amis** sans jamais passer en clair.
5. **Déconnexion** : les clés quittent l'appareil, et le serveur oublie l'appareil et ses enveloppes.

Si aucune clé n'est encore arrivée sur un appareil, la conversation propose « Créer une nouvelle clé ». Une nouvelle version de clé est alors créée pour tous les appareils. Les anciens messages restent lisibles là où l'ancienne clé existe.

## Vérifier qu'aucune clé n'a été substituée

Chaque conversation affiche un **code de sécurité** de 30 chiffres. Il est calculé sur les clés publiques de tous les appareils des deux amis et doit être identique sur les deux téléphones.
S'il diffère, un appareil inconnu participe à la conversation.

## Limites assumées

- Une seule clé par paire d'amis (avec versions), pas de renouvellement à chaque message. Un appareil compromis peut donc relire l'historique de la paire.
- Les métadonnées restent visibles par le serveur : qui écrit à qui, quand, et la taille des messages.
- La modération ne peut pas lire les messages privés. Le blocage et la suppression d'amitié restent possibles.

## Sans serveur (artefact et mode sans compte)

Quand l'interface fonctionne sans serveur, tous les comptes vivent dans le même navigateur. Chaque paire d'amis y a une clé AES-256-GCM (WebCrypto), rangée à part (`pepsgoal.keys.v1`), jamais dans la base.
Les données associées lient chaque message à sa conversation. L'export .zip d'un compte inclut ses clés (`keys.json`) pour relire ses conversations après restauration. Les sauvegardes complètes n'en contiennent aucune.
Les messages en clair des versions précédentes sont chiffrés automatiquement au premier lancement de la 1.1.0.

## Tests

- `packages/shared/src/shared.test.ts` :
  - aller-retour ;
  - message altéré ou mauvaise clé refusés ;
  - enveloppe illisible par un tiers ;
  - encodages identiques à Node ;
  - code de sécurité.
- `apps/server/test/e2e.mjs` :
  - clé transmise par enveloppe ;
  - message en clair refusé ;
  - clé inconnue refusée ;
  - dépôt de clé refusé sans amitié ;
  - nouvel appareil servi par re-chiffrement.
