#!/usr/bin/env bash
# Backs up the database (the only data that cannot be rebuilt: Redis holds presence and timers, both of which the
# system recreates from Postgres). Run it from cron, e.g. every night:
#   15 2 * * *  /opt/helpdesk/deploy/backup.sh >> /var/log/helpdesk-backup.log 2>&1
# Keeps the newest $KEEP_DAYS days. Copy the files off the machine too: a backup on the same disk is not a backup.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
mkdir -p "$DIR"
FILE="$DIR/helpdesk-$(date +%Y-%m-%d-%H%M).dump"

docker exec helpdesk-postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner > "$FILE"
# A dump that cannot be read back is worse than none: check it.
docker exec -i helpdesk-postgres pg_restore --list < "$FILE" > /dev/null
find "$DIR" -name 'helpdesk-*.dump' -mtime +"$KEEP_DAYS" -delete
echo "$(date -Is) backup ok: $FILE ($(du -h "$FILE" | cut -f1))"
