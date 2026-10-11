#!/bin/sh
# Diagnostic de la mise en ligne (VPS) : état des conteneurs, configuration Caddy, ports, pare-feu, DNS, réponses HTTP.
# Usage : /opt/pepsgoal/deploy/diagnose.sh   puis copier toute la sortie.
cd "$(dirname "$0")"
line() { printf '\n===== %s =====\n' "$1"; }

line "Conteneurs"
docker compose ps -a

line "Caddy : redémarrages et code de sortie"
docker inspect pepsgoal-caddy-1 --format 'Statut={{.State.Status}} Redémarrages={{.RestartCount}} CodeSortie={{.State.ExitCode}} OOM={{.State.OOMKilled}} Erreur={{.State.Error}}' 2>&1

line "Caddy : validation du Caddyfile"
docker run --rm -v "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1 | grep -v '"level":"info"' | tail -20

line "Caddy : journaux (hors lignes de démarrage)"
docker logs pepsgoal-caddy-1 2>&1 | grep -v -e maxprocs -e GOMEMLIMIT -e 'using config from file' | tail -40

line "Ports 80 / 443 ouverts sur la machine"
(ss -tlnp 2>/dev/null || netstat -tlnp) | grep -E ':(80|443)\b' || echo "Aucun service n'écoute sur 80/443"

line "Pare-feu local (ufw)"
command -v ufw >/dev/null && ufw status || echo "ufw absent"

line "DNS : adresses des noms de domaine / IP publique du VPS"
echo "IP publique du VPS : $(curl -s -4 --max-time 5 https://ifconfig.me || echo '?')"
for h in pepsgoal.fr app.pepsgoal.fr api.pepsgoal.fr; do printf '%-18s -> %s\n' "$h" "$(getent ahostsv4 "$h" | awk 'NR==1{print $1}')"; done

line "Réponses HTTP depuis le VPS lui-même"
for h in app.pepsgoal.fr api.pepsgoal.fr; do
  printf '%-18s http  : ' "$h"; curl -s -o /dev/null -w '%{http_code}\n' --max-time 8 --resolve "$h:80:127.0.0.1" "http://$h/" || echo "échec"
  printf '%-18s https : ' "$h"; curl -sk -o /dev/null -w '%{http_code}\n' --max-time 8 --resolve "$h:443:127.0.0.1" "https://$h/" || echo "échec"
done

line "Fichiers de la version web"
ls -la app | head -12
