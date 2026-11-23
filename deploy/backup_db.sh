#!/usr/bin/env bash
# Nightly PostgreSQL backup of the BENCH database. Run by cron (/etc/cron.d/bench) and by deploy.sh as the user "bench".
#   Files:     /srv/bench/backups/bench_YYYYmmdd_HHMMSS.dump   (pg_dump custom format, compressed)
#   Retention: 14 days (older dumps are deleted only AFTER a new good one exists)
#   Checks:    the dump must be non-empty and pg_restore --list must be able to read it back
#   Marks:     /srv/bench/state/ok-backup-db on success; /srv/bench/backups/LAST_FAILURE (date + reason) and exit 1 on failure,
#              so deploy.sh stops and check_bench.sh reports it.
#   Off-server copy (strongly recommended, a backup on the same disk dies with the server):
#              put  BACKUP_REMOTE=<rclone remote:path>  into /etc/bench-backup.env (configure the remote once with `rclone config`,
#              for example a Cloudflare R2 bucket). Every good dump is copied there.
#
# RESTORE (see also README-DEPLOY.md, "How to restore a backup"):
#   sudo systemctl stop bench-api bench-web
#   sudo -u postgres dropdb bench && sudo -u postgres createdb -O bench bench
#   sudo -u postgres pg_restore --no-owner --role=bench -d bench < /srv/bench/backups/<file>.dump
#   sudo systemctl start bench-api bench-web
# Practice it without risk with deploy/restore_drill.sh.
set -euo pipefail
umask 077

[ -f /etc/bench-backup.env ] && . /etc/bench-backup.env
DB_NAME="${DB_NAME:-bench}"
DIR=/srv/bench/backups
STATE=/srv/bench/state
KEEP_DAYS="${KEEP_DAYS:-14}"
mkdir -p "$DIR" "$STATE"
FILE="$DIR/${DB_NAME}_$(date +%Y%m%d_%H%M%S).dump"

fail() {
    echo "$(date -Is) database backup FAILED: $*" | tee "$DIR/LAST_FAILURE" >&2
    rm -f "$FILE"
    exit 1
}

# Refuse to start when the disk is nearly full: a half-written dump is worse than none.
FREE_MB=$(df -Pm "$DIR" | awk 'NR==2 {print $4}')
[ "$FREE_MB" -ge 500 ] || fail "less than 500 MB free on the backup disk (${FREE_MB} MB)"

pg_dump -Fc -d "$DB_NAME" -f "$FILE" || fail "pg_dump"
[ -s "$FILE" ] || fail "the dump file is empty"
pg_restore --list "$FILE" > /dev/null || fail "the dump cannot be read back (pg_restore --list)"

if [ -n "${BACKUP_REMOTE:-}" ]; then
    command -v rclone > /dev/null || fail "BACKUP_REMOTE is set but rclone is not installed"
    rclone copy "$FILE" "$BACKUP_REMOTE" || fail "copy to $BACKUP_REMOTE"
    echo "$(date -Is) copied off the server to $BACKUP_REMOTE"
fi

find "$DIR" -name "${DB_NAME}_*.dump" -mtime +"$KEEP_DAYS" -delete
rm -f "$DIR/LAST_FAILURE"
touch "$STATE/ok-backup-db"
echo "$(date -Is) database backup ok: $FILE ($(du -h "$FILE" | cut -f1))"
