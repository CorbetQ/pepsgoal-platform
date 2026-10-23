#!/bin/sh
# Met en ligne la dernière version du code (depuis GitHub) : reconstruit l'API, applique les migrations, redémarre.
# Usage : /opt/pepsgoal/deploy/update.sh          (API seulement)
#         /opt/pepsgoal/deploy/update.sh --web    (API + version web app.pepsgoal.fr, une minute de plus)
# Les lignes « ::step n/total libellé » et « ::done » servent à la barre de progression de Modération › Serveur
# (application Android et version web), qui lance ce script en SSH et suit deploy/logs/update.log.
set -eu
cd "$(dirname "$0")"
WEB=0; [ "${1:-}" = "--web" ] && WEB=1
TOTAL=$((4 + WEB)); N=0
step() { N=$((N + 1)); echo "::step $N/$TOTAL $1"; }

step "Récupération du code"
# package-lock.json est réécrit par la construction de la version web (npm install dans Docker) : on rend la version du dépôt
git -C .. checkout -- package-lock.json 2>/dev/null || true
git -C .. pull --ff-only
if [ "$WEB" = 1 ]; then step "Construction de la version web"; sh ./web-build.sh; fi
step "Reconstruction de l'API"
docker compose up -d --build
step "Nettoyage"
docker image prune -f > /dev/null
step "Vérification"
sleep 5
docker compose ps
curl -fsS https://api.pepsgoal.fr/v1/status && printf '\nAPI en ligne.\n'
if [ "$WEB" = 1 ]; then curl -fsS -o /dev/null -w "Version web : HTTP %{http_code}\n" https://app.pepsgoal.fr/; fi
echo "::done"
exit 0
