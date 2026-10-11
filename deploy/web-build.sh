#!/bin/sh
# Compile la version web de l'app et la place dans deploy/app, servi par Caddy sur https://app.pepsgoal.fr.
# Node n'a pas besoin d'être installé : la compilation se fait dans un conteneur Docker jetable.
# Usage : /opt/pepsgoal/deploy/web-build.sh        (API par défaut : https://api.pepsgoal.fr)
set -eu
cd "$(dirname "$0")/.."
API_URL="${API_URL:-https://api.pepsgoal.fr}"
rm -rf deploy/app-build
docker run --rm -v "$PWD":/work -w /work -e EXPO_PUBLIC_API_URL="$API_URL" node:20-bookworm sh -c \
  "(if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi) && cd apps/app && npx expo export --platform web --clear --output-dir /work/deploy/app-build"
test -f deploy/app-build/index.html || { echo "Échec : index.html absent de l'export."; exit 1; }
# On remplace le contenu sans supprimer le dossier : Caddy le lit en direct (montage Docker)
find deploy/app -mindepth 1 ! -name .gitkeep -delete
cp -a deploy/app-build/. deploy/app/
rm -rf deploy/app-build
echo "Version web publiée ($(du -sh deploy/app | cut -f1)), API : $API_URL"
