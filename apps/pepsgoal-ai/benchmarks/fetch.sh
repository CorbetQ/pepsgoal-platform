#!/bin/sh
# Télécharge le corpus de test (photos Unsplash, non redistribuées dans le dépôt) au format 1080 × 1920.
# Les 16 photos personnelles du propriétaire (« perso_… ») ne sont pas téléchargeables : copie manuelle.
# Usage : sh benchmarks/fetch.sh   (depuis apps/pepsgoal-ai)
set -e
cd "$(dirname "$0")"; mkdir -p photos
python3 -c "
import json
for m in json.load(open('manifest.json')):
    if 'url' in m: print(m['url'] + '?w=1080&h=1920&fit=crop&crop=entropy&q=90&fm=jpg', m['fichier'])
" | while read -r url file; do [ -f "$file" ] || curl -sf -m 60 -o "$file" "$url"; done
ls photos | wc -l
