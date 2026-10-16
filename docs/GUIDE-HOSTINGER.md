# Déployer le serveur PepsGoal sur Hostinger

Résultat : `https://api.pepsgoal.fr` (API de l'app) et `https://pepsgoal.fr` (site et pages légales), en HTTPS, avec sauvegardes quotidiennes.

## 0. Quel produit Hostinger ?

Il faut un **VPS** (offre « KVM 1 » suffisante pour démarrer : 1 vCPU, 4 Go de RAM).
L'hébergement web mutualisé (Premium, Business, Cloud) ne convient pas : il ne propose pas PostgreSQL, indispensable au serveur.

## 1. Préparer le code sur GitHub (sur ton ordinateur)

1. Crée un dépôt **privé** sur github.com, par exemple `pepsgoal-platform`.
2. Dans le dossier `pepsgoal-platform` :
   ```bash
   npm install
   git init
   git add .
   git commit -m "PepsGoal 1.1.0"
   git branch -M main
   git remote add origin https://github.com/TON-COMPTE/pepsgoal-platform.git
   git push -u origin main
   ```
   `npm install` crée `package-lock.json` : garde-le dans le dépôt, les compilations seront identiques partout.

## 2. Installer le VPS

1. hPanel › **VPS** › **Gérer** › **OS & Panel** › **Système d'exploitation** › **Changer d'OS** : cherche **Docker**, choisis le modèle *Ubuntu 24.04 with Docker* (environ 10 minutes).
2. Note l'**adresse IP** du VPS (page d'accueil du VPS) et définis le mot de passe root.
3. hPanel › VPS › **Pare-feu** : crée une règle qui autorise uniquement les ports **22** (SSH), **80** et **443** (TCP), plus **443 UDP** si proposé. Active-la.
4. Connecte-toi depuis ton ordinateur (PowerShell) :
   ```bash
   ssh root@IP-DU-VPS
   ```
5. Vérifie Docker : `docker --version` puis `docker compose version`.

## 3. Configurer le DNS de pepsgoal.fr

hPanel › **Domaines** › pepsgoal.fr › **DNS / Serveurs de noms** › **Gérer les enregistrements DNS**.
Supprime d'abord les enregistrements `A` existants pour `@` et `www` (page de parking), puis ajoute :

| Type | Nom | Valeur | TTL |
| --- | --- | --- | --- |
| A | `@` | IP du VPS | 3600 |
| A | `api` | IP du VPS | 3600 |
| CNAME | `www` | `pepsgoal.fr` | 3600 |
| A | `app` | IP du VPS (version web, voir GUIDE-WEB-HOSTINGER.md ; à omettre si l'app web est sur l'hébergement mutualisé) | 3600 |

La propagation prend de quelques minutes à quelques heures. Vérifie avec `nslookup api.pepsgoal.fr` : l'IP du VPS doit s'afficher.
**Attends que ce soit le cas avant l'étape 5** : sinon Caddy ne peut pas obtenir les certificats HTTPS.

## 4. Récupérer le code et créer les secrets (sur le VPS)

```bash
apt update && apt install -y git
git clone https://github.com/TON-COMPTE/pepsgoal-platform.git /opt/pepsgoal
cd /opt/pepsgoal/deploy
cp .env.example .env
openssl rand -hex 24   # à coller dans POSTGRES_PASSWORD
openssl rand -hex 48   # à coller dans JWT_SECRET
nano .env
```
Dans `nano` : remplace chaque `CHANGE-MOI`. Pour `ADMIN_BOOTSTRAP_PASSWORD`, choisis un mot de passe d'au moins 12 caractères. Enregistre avec Ctrl+O, Entrée, puis quitte avec Ctrl+X.
Conserve ces valeurs dans un gestionnaire de mots de passe : sans `POSTGRES_PASSWORD`, la base est inaccessible.

Pour GitHub, un dépôt privé demande un identifiant : utilise un *Personal Access Token* (GitHub › Settings › Developer settings › Fine-grained tokens, accès en lecture au dépôt) à la place du mot de passe.

## 5. Lancer PepsGoal

```bash
cd /opt/pepsgoal/deploy
chmod +x backup.sh update.sh
docker compose up -d --build
docker compose logs -f server   # Ctrl+C pour quitter
```
Au premier démarrage :
- les tables sont créées : `Migrations appliquées` apparaît dans les logs ;
- les comptes `admin` et PepsGoal Officiel sont créés ;
- Caddy obtient les certificats HTTPS.

Vérifie :
```bash
curl https://api.pepsgoal.fr/v1/status
```
La réponse attendue : `{"ok":true,…,"minAppVersion":"1.1.0"}`. Ouvre aussi https://pepsgoal.fr dans un navigateur.

Ensuite, connecte-toi dans l'app avec `admin` et le mot de passe de `ADMIN_BOOTSTRAP_PASSWORD`, puis change-le (route `POST /v1/auth/password`, voir docs/API.md).

## 6. Pages légales

Rien à faire à la main : `deploy/web-build.sh` (lancé par `update.sh --web`) génère les CGU, les mentions légales et la charte de confidentialité à partir des textes de l'application.
Elles sont servies sur `https://pepsgoal.fr/cgu`, `https://pepsgoal.fr/mentions-legales` et `https://pepsgoal.fr/confidentialite` : ce sont les adresses à donner aux stores.
Pour les modifier : constante `LEGAL` de `apps/web-legacy/pepsgoal.html`, puis `update.sh --web`.
Hébergeur à indiquer dans les mentions légales (déjà fait dans l'app web) : **Hostinger International Ltd, 61 Lordou Vironos Street, 6023 Larnaca, Chypre** (www.hostinger.fr). Vérifie ces coordonnées et ajoute le numéro de téléphone figurant sur ta facture Hostinger : la loi (LCEN) demande le téléphone de l'hébergeur.

## 6 ter. Sous-domaine site.pepsgoal.fr

L'aide de l'application renvoie vers `https://site.pepsgoal.fr`, qui affiche le même site que `https://pepsgoal.fr`.
Dans hPanel › Domaines › pepsgoal.fr › DNS, ajoute un enregistrement **A** : nom `site`, valeur = IP du VPS. Caddy obtient le certificat HTTPS tout seul (quelques minutes après la propagation du DNS).

## 6 bis. E-mails de modération

À chaque signalement, publication à valider (compte sous avertissement) ou demande de débannissement, le serveur envoie un e-mail à `MOD_EMAIL` (par défaut quentin-corbet@outlook.fr). Il lui faut une boîte d'envoi, par exemple `noreply@pepsgoal.fr` :

1. hPanel › **Emails** : crée la boîte `noreply@pepsgoal.fr`. Le VPS n'inclut pas d'e-mails : il faut une offre **Hostinger Email** (ou les boîtes gratuites d'un hébergement web Hostinger). Si les serveurs de noms de pepsgoal.fr sont ceux de Hostinger, les enregistrements DNS (MX, SPF, DKIM) sont ajoutés automatiquement.
2. Dans `deploy/.env` sur le VPS, renseigne :
   ```
   MOD_EMAIL=quentin-corbet@outlook.fr
   SMTP_HOST=smtp.hostinger.com
   SMTP_PORT=465
   SMTP_USER=noreply@pepsgoal.fr
   SMTP_PASS=le-mot-de-passe-de-la-boite
   MAIL_FROM=PepsGoal <noreply@pepsgoal.fr>
   ```
3. Applique : `cd /opt/pepsgoal/deploy && docker compose up -d`.
4. Teste : signale une publication depuis un compte de test. En cas de souci, `docker compose logs server | grep mail` affiche l'erreur (mot de passe, port bloqué…).
5. Dans Outlook, ajoute `noreply@pepsgoal.fr` aux expéditeurs approuvés pour que les alertes n'arrivent pas dans les courriers indésirables.

Au plus 30 e-mails par heure (`MAIL_MAX_PER_HOUR`) ; au-delà, les alertes restent visibles dans l'onglet Modération. Sans `SMTP_HOST`, aucun e-mail n'est envoyé.
Autre fournisseur SMTP (Brevo, OVH…) : remplace les valeurs SMTP et mets à jour la section « Destinataires et services tiers » de la charte de confidentialité.

## 6 quater. Notifications push

Rien à configurer : au premier démarrage, le serveur génère ses clés VAPID et les garde en base (table `app_settings`). Pour fixer les clés toi-même (par exemple pour les réutiliser sur un autre serveur), ajoute dans `.env` :

```
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:quentin-corbet@outlook.fr
```

(clés générées avec `npx web-push generate-vapid-keys`). Changer de clés oblige chaque navigateur à se réabonner, ce que l'application fait seule à l'ouverture suivante. Le fichier `/sw.js` doit être servi sans cache : c'est déjà le cas avec le `Caddyfile` et le `.htaccess` fournis.

## 7. Sauvegardes

1. Sauvegarde quotidienne de la base et des photos (14 jours conservés dans `/root/pepsgoal-backups`) :
   ```bash
   crontab -e
   ```
   Ajoute la ligne : `30 3 * * * /opt/pepsgoal/deploy/backup.sh >> /var/log/pepsgoal-backup.log 2>&1`
2. Teste-la une fois à la main : `/opt/pepsgoal/deploy/backup.sh`.
3. Active aussi les **sauvegardes/instantanés** du VPS dans hPanel.
4. Copie régulièrement une sauvegarde hors du VPS (depuis ton PC) : `scp root@IP-DU-VPS:/root/pepsgoal-backups/db-AAAA-MM-JJ.dump .`

Restaurer une sauvegarde de la base :
```bash
cd /opt/pepsgoal/deploy
docker compose exec -T db pg_restore -U pepsgoal -d pepsgoal --clean --if-exists < /root/pepsgoal-backups/db-AAAA-MM-JJ.dump
```

## 8. Mettre à jour

Sur ton PC : `git push`. Puis sur le VPS :
```bash
/opt/pepsgoal/deploy/update.sh
```
Le script récupère le code, reconstruit l'API, applique les migrations et redémarre (quelques secondes d'interruption). Les données sont conservées dans les volumes Docker.

## Dépannage

| Symptôme | Vérification |
| --- | --- |
| HTTPS ne fonctionne pas | `docker compose logs caddy` : le DNS doit pointer vers le VPS et les ports 80/443 être ouverts dans le pare-feu hPanel |
| Le serveur redémarre en boucle | `docker compose logs server` : un `CHANGE-MOI` resté dans `.env` ou un mot de passe admin trop court |
| L'app reste « hors ligne » | `curl https://api.pepsgoal.fr/v1/status` depuis ton PC |
| Disque plein | `df -h`, puis `docker system prune` (ne supprime pas les volumes) |

Ne lance **jamais** `docker compose down -v` : l'option `-v` supprime la base et les photos.
