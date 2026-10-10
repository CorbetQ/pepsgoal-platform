#!/bin/sh
# Met en ligne la dernière version du code (depuis GitHub) : reconstruit l'API, applique les migrations, redémarre.
# Usage : /opt/pepsgoal/deploy/update.sh
set -eu
cd "$(dirname "$0")"
git -C .. pull --ff-only
docker compose up -d --build
docker image prune -f > /dev/null
sleep 5
docker compose ps
curl -fsS https://api.pepsgoal.fr/v1/status && echo "\nAPI en ligne."
