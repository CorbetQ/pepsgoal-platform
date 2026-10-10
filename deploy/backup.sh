#!/bin/sh
# Sauvegarde de PepsGoal : base de données (pg_dump) + photos. Conserve 14 jours.
# Installation (une fois) : crontab -e, puis ajouter la ligne :
#   30 3 * * * /opt/pepsgoal/deploy/backup.sh >> /var/log/pepsgoal-backup.log 2>&1
set -eu
cd "$(dirname "$0")"
DEST=/root/pepsgoal-backups
D=$(date +%F)
mkdir -p "$DEST"

docker compose exec -T db pg_dump -U pepsgoal -Fc pepsgoal > "$DEST/db-$D.dump"
docker run --rm -v pepsgoal_media:/media:ro -v "$DEST:/backup" alpine tar czf "/backup/media-$D.tgz" -C /media .

find "$DEST" -type f -mtime +14 -delete
echo "$(date '+%F %T') sauvegarde terminée : $(du -sh "$DEST" | cut -f1) au total"
