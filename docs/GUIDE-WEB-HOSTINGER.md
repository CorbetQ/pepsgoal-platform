# Mettre en ligne la version web de PepsGoal sur Hostinger

Objectif : `https://app.pepsgoal.fr` affiche l'application. C'est exactement l'interface de l'artefact PepsGoal, branchée sur le serveur ; les apps iPhone et Android embarquent la même.

La version web n'est qu'un ensemble de fichiers statiques : un `index.html` (toute l'application), un dossier `fonts/`, un dossier `emoji/` (emojis Fluent), un dossier `legal/`, deux icônes, un manifeste et un `.htaccess`.
Elle peut donc être hébergée **sur le VPS** (à côté de l'API) **ou sur l'hébergement web mutualisé** Hostinger.
Dans les deux cas, elle parle à l'API `https://api.pepsgoal.fr`, qui reste sur le VPS (voir GUIDE-HOSTINGER.md).

> L'artefact claude.ai et `app.pepsgoal.fr` restent deux publications distinctes : republier l'artefact ne change rien sur ton domaine. Pour modifier l'application, on modifie `apps/web-legacy/pepsgoal.html` puis on reconstruit (A5 ou B7).

---

## 0. Pourquoi « HTTP ERROR 404 » sur app.pepsgoal.fr ?

Un serveur répond bien pour `app.pepsgoal.fr`, mais il ne trouve pas d'`index.html` à la racine du dossier qu'il sert. Pour savoir **quel** serveur répond, lance depuis ton PC (PowerShell) :

```bash
curl.exe -sI https://app.pepsgoal.fr
```

| Ligne `server:` de la réponse | Qui répond | Cause probable et correction |
| --- | --- | --- |
| `Caddy` | ton VPS | Le bloc `app.pepsgoal.fr` était commenté dans l'ancien `deploy/Caddyfile`, ou le dossier `deploy/app` est vide. Suis l'**option A**. |
| `LiteSpeed`, `hcdn` ou `hostinger` | l'hébergement web mutualisé | Le dossier du sous-domaine est vide, ou les fichiers sont dans un sous-dossier (`app/dist/index.html` au lieu de `app/index.html`). Suis l'**option B**. |

À retenir : **un sous-domaine ne pointe que vers un seul endroit**. Si le DNS de `app` pointe vers le VPS, ce que tu déposes sur l'hébergement web ne sera jamais affiché, et inversement.

---

## Quelle option choisir ?

| | A. VPS (recommandé) | B. Hébergement web mutualisé |
| --- | --- | --- |
| Offre Hostinger | le VPS de l'API | Premium, Business ou Cloud |
| Mise à jour | une commande (`update.sh --web`) | compiler sur ton PC, puis envoyer un .zip |
| HTTPS | automatique (Caddy) | à activer dans hPanel |
| Avantage | tout au même endroit, rien à faire à la main | utile si tu as déjà un hébergement web et pas encore de VPS pour l'API |

---

## Prérequis communs

1. **L'API répond** : `curl.exe https://api.pepsgoal.fr/v1/status` renvoie `{"ok":true,…}`.
2. **L'API accepte le site** : dans `deploy/.env` sur le VPS, `CORS_ORIGINS=https://app.pepsgoal.fr`.
   - Après une modification : `cd /opt/pepsgoal/deploy && docker compose up -d`.
   - Sans ce réglage, l'app s'ouvre mais reste « hors ligne » : le navigateur bloque les appels à l'API.
3. **Le code est à jour** : version 1.1.0 ou plus récente. Elle inclut `apps/web/build.mjs`, le fichier `.htaccess`, le script `deploy/web-build.sh` et l'adresse de l'API par défaut. Envoie-le sur GitHub depuis ton PC :
   ```bash
   git add .
   git commit -m "Version web"
   git push
   ```

---

## Option A — Sur le VPS (à côté de l'API)

### A1. DNS
hPanel › **Domaines** › pepsgoal.fr › **DNS / Serveurs de noms**.
- Il faut un enregistrement **A**, nom `app`, valeur = **IP du VPS**.
- Supprime tout autre enregistrement `app` (A, AAAA ou CNAME), en particulier celui créé automatiquement par un sous-domaine d'hébergement web.

Vérifie avec `nslookup app.pepsgoal.fr` : l'IP du VPS doit apparaître.

### A2. Récupérer le code et compiler (sur le VPS)
```bash
ssh root@IP-DU-VPS
cd /opt/pepsgoal
git pull
chmod +x deploy/web-build.sh deploy/update.sh
./deploy/web-build.sh
```
Le script construit l'app dans un conteneur Node jetable (rien à installer), puis la dépose dans `deploy/app/`.
- Compte moins d'une minute.
- La dernière ligne doit être `Version web publiée (… ), API : https://api.pepsgoal.fr`.
- Vérifie le résultat : `ls deploy/app` doit afficher `favicon.png  fonts  icon-512.png  index.html  manifest.webmanifest`.

### A3. Prendre en compte la nouvelle configuration de Caddy
Le `Caddyfile` sert désormais `app.pepsgoal.fr`, et `docker-compose.yml` monte le dossier `deploy/app`. Pour que Caddy relise les deux :
```bash
cd /opt/pepsgoal/deploy
docker compose up -d --force-recreate caddy
docker compose logs --tail 30 caddy
```
Dans les journaux doit apparaître l'obtention du certificat pour `app.pepsgoal.fr` (`certificate obtained successfully`).

### A4. Vérifier
```bash
curl -sI https://app.pepsgoal.fr | head -5
curl -sI https://app.pepsgoal.fr/fonts/manrope-latin-400.woff2 | head -1
```
- Les deux doivent répondre `HTTP/2 200` avec `server: Caddy`. La seconde vérifie que les polices sont bien servies.
- Ouvre ensuite https://app.pepsgoal.fr : l'écran de connexion PepsGoal s'affiche.

### A5. Mettre à jour plus tard
Sur ton PC : `git push`. Puis sur le VPS :
```bash
/opt/pepsgoal/deploy/update.sh --web
```
Sans `--web`, seule l'API est mise à jour.

---

## Option B — Sur l'hébergement web mutualisé

### B1. Construire sur ton PC
1. Installe **Node.js 20 LTS** depuis nodejs.org, une seule fois.
2. Dans le dossier `pepsgoal-platform` (PowerShell) :
   ```bash
   npm install -w apps/web
   ```
   ```bash
   npm run build:web
   ```
   La dernière ligne affiche l'adresse de l'API utilisée (`https://api.pepsgoal.fr` par défaut).
3. Ouvre `apps/web/dist`. Tu dois y voir :
   - `index.html`, `manifest.webmanifest`, `favicon.png`, `icon-512.png` et les dossiers `fonts`, `emoji` et `legal` ;
   - `.htaccess` (fichier caché : dans l'Explorateur, menu **Affichage › Afficher › Éléments masqués**).
4. **Sélectionne tout le contenu** de `dist`, pas le dossier lui-même. Fais un clic droit › **Compresser dans un fichier ZIP** et nomme le fichier `pepsgoal-web.zip`.

### B2. Créer le sous-domaine
hPanel › **Sites web** › pepsgoal.fr › **Tableau de bord** › **Domaines** › **Sous-domaines** :
- Sous-domaine : `app`.
- Dossier : laisse celui proposé, ou coche « dossier personnalisé » et indique `app`. **Note le chemin affiché**, par exemple `public_html/app`.
- Clique sur **Créer**.

### B3. DNS
- **Les serveurs de noms de pepsgoal.fr sont ceux de Hostinger** : la création du sous-domaine ajoute elle-même l'enregistrement `app` vers l'hébergement web. Vérifie dans **DNS / Serveurs de noms** qu'il n'existe **pas en plus** un enregistrement A `app` vers le VPS, créé avec le guide de l'API. S'il existe, supprime-le.
- **Le domaine est géré ailleurs** : crée un enregistrement A `app` avec l'IP de l'hébergement web. Elle est indiquée dans hPanel › **Sites web** › **Tableau de bord** › **Détails de l'hébergement**.

### B4. Envoyer les fichiers
hPanel › **Fichiers** › **Gestionnaire de fichiers** :
1. Ouvre le dossier noté à l'étape B2, par exemple `public_html/app`.
2. Supprime les fichiers par défaut s'il y en a (`default.php`, `index.php`).
3. Clique sur **Importer** et envoie `pepsgoal-web.zip`. Fais ensuite un clic droit sur le fichier › **Extraire**, en laissant le dossier de destination tel quel (`.`), puis supprime le .zip.
4. Contrôle : directement dans `public_html/app`, tu dois voir `index.html`, `.htaccess` et `fonts`.
   - Si tu vois un dossier `dist`, c'est que le dossier a été zippé au lieu de son contenu. Déplace son contenu d'un niveau vers le haut.
   - Si `.htaccess` n'apparaît pas, active « Afficher les fichiers cachés » dans les réglages du gestionnaire.

Envoi par **FTP** (FileZilla) : les identifiants sont dans hPanel › **Fichiers** › **Comptes FTP**. Envoie le contenu de `apps/web/dist` dans le même dossier.

### B5. HTTPS
hPanel › **Sécurité** › **SSL** : installe le certificat gratuit pour `app.pepsgoal.fr`. Le délai va de quelques minutes à quelques heures après la mise en place du DNS. Le `.htaccess` redirige ensuite automatiquement vers HTTPS.

### B6. Vérifier
```bash
curl.exe -sI https://app.pepsgoal.fr
```
```bash
curl.exe -sI https://app.pepsgoal.fr/fonts/manrope-latin-400.woff2
```
Les deux commandes doivent répondre `200`. Ouvre ensuite le site et connecte-toi : tu retrouves l'interface de l'artefact avec tes données du serveur.

### B7. Mettre à jour plus tard
1. Reconstruis (étape B1), puis supprime tout le contenu du dossier `public_html/app` (il ne contient que l'app).
2. Importe et extrais le nouveau .zip.
3. Si une ancienne version s'affiche encore : hPanel › **Performances** › **Cache** (ou **CDN**) › **Vider le cache**, puis recharge avec Ctrl+F5.

---

## Dépannage

Sur le VPS, `/opt/pepsgoal/deploy/diagnose.sh` rassemble en une fois l'état des conteneurs, la validation du Caddyfile, les journaux utiles, les ports, le pare-feu, le DNS et les réponses HTTP.


| Symptôme | Cause | Correction |
| --- | --- | --- |
| `HTTP ERROR 404` sur la page d'accueil | pas d'`index.html` à la racine du dossier servi | voir l'étape 0, puis A2 ou B4 |
| Polices différentes de l'artefact | dossier `fonts/` absent ou dans un sous-dossier | les fichiers doivent être à la racine du sous-domaine, `fonts/` compris |
| L'app reste « Hors ligne » | API injoignable, ou origine refusée | `curl.exe https://api.pepsgoal.fr/v1/status`, puis `CORS_ORIGINS=https://app.pepsgoal.fr` dans `deploy/.env` et `docker compose up -d`. Dans le navigateur (F12 › Console), une erreur « CORS » confirme la cause. |
| Le navigateur affiche une erreur de certificat | certificat pas encore émis (DNS récent) | attendre la propagation ; VPS : `docker compose logs caddy` ; hébergement web : hPanel › SSL |
| `ERR_CONNECTION_TIMED_OUT`, et `curl -sI` n'affiche rien | Caddy redémarre en boucle (`docker compose ps` : `Restarting`) ou ports 80/443 fermés | lancer `diagnose.sh` : la validation du Caddyfile et les journaux indiquent l'erreur ; vérifier le pare-feu hPanel (TCP 80 et 443 autorisés) |
| Ancienne version affichée | cache | Ctrl+F5 ; hébergement web : vider le cache dans hPanel |

## Récapitulatif des adresses

| Adresse | Contenu | Hébergé sur |
| --- | --- | --- |
| `https://pepsgoal.fr` | site vitrine et pages légales | VPS (`deploy/site`) ou hébergement web |
| `https://app.pepsgoal.fr` | application web | option A (VPS) ou B (hébergement web) |
| `https://api.pepsgoal.fr` | API et base de données | VPS uniquement (PostgreSQL et Node.js) |
