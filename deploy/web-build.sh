#!/bin/sh
# Construit la version web de PepsGoal (l'interface PepsGoal + la couche connectée) et la place dans deploy/app,
# servi par Caddy sur https://app.pepsgoal.fr.
# Node n'a pas besoin d'être installé : la construction se fait dans un conteneur Docker jetable (moins d'une minute).
# Usage : /opt/pepsgoal/deploy/web-build.sh        (API par défaut : https://api.pepsgoal.fr)
set -eu
cd "$(dirname "$0")/.."
API_URL="${API_URL:-https://api.pepsgoal.fr}"
docker run --rm -v "$PWD":/work -w /work -e PEPSGOAL_API="$API_URL" node:20-bookworm sh -c \
  "npm install --no-audit --no-fund --ignore-scripts -w apps/web && node apps/web/build.mjs"
test -f apps/web/dist/index.html || { echo "Échec : apps/web/dist/index.html absent."; exit 1; }
# On remplace le contenu sans supprimer le dossier : Caddy le lit en direct (montage Docker)
find deploy/app -mindepth 1 ! -name .gitkeep -delete
cp -a apps/web/dist/. deploy/app/
echo "Version web publiée ($(du -sh deploy/app | cut -f1)), API : $API_URL"
