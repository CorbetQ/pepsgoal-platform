#!/bin/sh
# Met en ligne la dernière version du code (depuis GitHub) : reconstruit l'API, applique les migrations, redémarre.
# Usage : /opt/pepsgoal/deploy/update.sh          (API seulement)
#         /opt/pepsgoal/deploy/update.sh --web    (API + version web app.pepsgoal.fr, quelques minutes de plus)
set -eu
cd "$(dirname "$0")"
git -C .. pull --ff-only
[ "${1:-}" = "--web" ] && ./web-build.sh
docker compose up -d --build
docker image prune -f > /dev/null
sleep 5
docker compose ps
curl -fsS https://api.pepsgoal.fr/v1/status && printf '\nAPI en ligne.\n'
[ "${1:-}" = "--web" ] && curl -fsS -o /dev/null -w "Version web : HTTP %{http_code}\n" https://app.pepsgoal.fr/
exit 0
