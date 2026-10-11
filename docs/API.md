# API PepsGoal (v1)

Toutes les routes sont préfixées par `/v1`. Authentification : en-tête `Authorization: Bearer <jeton d'accès>`.
Erreurs : `{ "error": "code", "message": "texte lisible" }` avec le code HTTP correspondant (400 données invalides,
401 session, 403 interdit ou banni, 404, 409 conflit, 429 trop de requêtes, 503 maintenance).

## Public
| Méthode | Route | Rôle |
| --- | --- | --- |
| GET | `/status` | Serveur joignable, maintenance en cours, version minimale de l'app |

## Comptes
| Méthode | Route | Rôle |
| --- | --- | --- |
| POST | `/auth/register` | Inscription (`username`, `displayName`, `password`, `acceptTerms: true`) ; message de bienvenue + dernières nouveautés |
| POST | `/auth/login` | Connexion |
| POST | `/auth/refresh` | Nouveau jeton d'accès (le jeton de renouvellement est remplacé) |
| POST | `/auth/logout` | Révoque le jeton de renouvellement |
| POST | `/auth/password` | Changement de mot de passe (révoque les autres sessions) |
| GET / PATCH | `/me` | Profil, état de modération, bonus de bienvenue ; modification du nom, de la bio, de l'avatar |
| DELETE | `/me` | Suppression définitive du compte (mot de passe requis) |
| POST | `/me/freezes/use` | Utilise `count` gels de série (409 s'il n'y en a pas assez) |
| POST | `/me/welcome-bonus` | +5 gels de série à la fin du tutoriel (une seule fois par compte) |
| GET | `/me/export` | Export JSON des données du compte (messages privés tels que stockés : chiffrés) |

## Synchronisation
| Méthode | Route | Rôle |
| --- | --- | --- |
| POST | `/sync/push` | Envoi de la file d'attente (voir SYNC.md) |
| GET | `/sync/pull?cursor=N` | Changements depuis la révision N |
| POST | `/checkins/:id/confirm` · `/refuse` | Binôme de motivation : confirmer ou refuser une validation |

## Social (compte requis ; écriture refusée si banni ou en maintenance)
| Méthode | Route | Rôle |
| --- | --- | --- |
| GET | `/users/search?q=` | Recherche de comptes |
| GET | `/users/:id` | Profil d'un utilisateur : bio, amitié, jours validés, flammes, nombre d'amis, objectifs visibles (publics, amis, binôme, membre) et leurs validations |
| GET | `/friends` | Amis (avec leur série en cours, leurs jours validés et leurs flammes, pour le classement), demandes reçues et envoyées, `myStreak` |
| POST | `/friends/requests` · `/friends/requests/:id/accept` · `/decline` | Demandes d'amis |
| DELETE | `/friends/:userId` | Retirer un ami |
| POST / DELETE | `/users/:id/block` | Bloquer / débloquer |
| GET | `/feed?tab=friends\|public&before=` | Fil paginé (20) avec encouragements (et qui a encouragé), commentaires |
| POST / DELETE | `/posts` · `/posts/:id` | Publier (`kind` : `manual` ou `milestone` pour les publications automatiques ; en attente si compte averti) / supprimer |
| POST / DELETE | `/posts/:id/like` | Encourager (un gel de série tous les 10 encouragements reçus) |
| POST | `/posts/:id/comments` · DELETE `/comments/:id` | Commenter / supprimer |
| POST | `/posts/:id/report` | Signaler |
| GET / POST | `/stories` | Stories des amis (24 h) / publier |
| POST | `/stories/:id/view` · GET `/stories/:id/views` · DELETE `/stories/:id` | Vue, liste des vues, suppression |
| GET | `/conversations` · `/conversations/:userId` | Conversations (PepsGoal Officiel épinglé) / messages |
| POST | `/conversations/:userId` | Envoyer un message chiffré (amis uniquement) : `{ "e2e": { "v": 1, "keyId", "nonce", "ct" } }` ; tout message en clair est refusé (400) |

## Chiffrement de bout en bout (voir E2E.md)
| Méthode | Route | Rôle |
| --- | --- | --- |
| POST | `/e2e/devices` | Publie la clé publique X25519 d'un appareil → `{ deviceId }` (10 appareils max par compte) |
| DELETE | `/e2e/devices/:id` | Oublie un appareil et ses enveloppes (déconnexion) |
| GET | `/e2e/peers/:userId?deviceId=` | Appareils des deux amis, versions de clé, enveloppe destinée à cet appareil, appareils sans enveloppe |
| POST | `/e2e/peers/:userId/keys` | Crée une version de clé et/ou dépose des enveloppes `{ keyId, envelopes: [{ deviceId, senderDeviceId, nonce, box }] }` |
| GET | `/e2e/pending?deviceId=` | Clés détenues par cet appareil qu'un autre appareil de la paire n'a pas encore (re-chiffrement automatique) |
| GET | `/notifications` · POST `/notifications/read-all` | Notifications |
| POST | `/notify` | Notification à un ami ou à un membre d'un objectif partagé (`to`, `text`, `type`, `goalId`) ; 60 par heure |
| POST | `/appeals` | Demande de débannissement |
| POST | `/media` | Téléverser une image (multipart, 8 Mo max) |

## Modération (compte admin)
| Méthode | Route | Rôle |
| --- | --- | --- |
| GET | `/admin/overview` | Chiffres clés |
| GET | `/admin/users?q=&filter=` | Comptes (`banned`, `warned`, `muted`, `new`) |
| POST | `/admin/users/:id/warn` · `unwarn` · `ban` · `unban` · `comments` · `message` | Sanctions et message officiel (message automatique à chaque décision) |
| DELETE | `/admin/users/:id` | Supprimer un compte |
| GET | `/admin/posts?scope=pending\|reported\|recent` | Publications à traiter |
| POST | `/admin/posts/:id/approve` · `reject` · `delete` · `lock` · `unlock` · `dismiss` | Décisions sur une publication |
| GET | `/admin/appeals?status=` · POST `/admin/appeals/:id/accept` · `refuse` | Contestations |
| GET / POST | `/admin/maintenance` · POST `/admin/maintenance/end` | Maintenances |
| GET / POST | `/admin/announcements` | Annonces de PepsGoal Officiel : liste / publier |
| DELETE | `/admin/announcements/:id` | Retirer une annonce du message de bienvenue des nouveaux comptes |
| GET | `/admin/modlog` | Journal de modération |
