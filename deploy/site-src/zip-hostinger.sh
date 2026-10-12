#!/bin/sh
# Construit le site puis l'emballe pour un hébergement web mutualisé Hostinger :
# le contenu du zip (fichiers + .htaccess) s'extrait directement dans public_html.
# Usage : sh deploy/site-src/zip-hostinger.sh [chemin/du/fichier.zip]   (par défaut : deploy/pepsgoal-site-hostinger.zip)
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
out="${1:-$here/../pepsgoal-site-hostinger.zip}"
case "$out" in /*) ;; *) out="$PWD/$out" ;; esac
node "$here/build.mjs"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cp -a "$here/../site/." "$tmp/"
cp "$here/hostinger/.htaccess" "$tmp/.htaccess"
rm -f "$out"
(cd "$tmp" && zip -qr -X "$out" . -x '*.DS_Store')
echo "Archive prête : $out ($(du -h "$out" | cut -f1)) — à extraire dans public_html"
