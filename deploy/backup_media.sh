#!/usr/bin/env bash
# Weekly backup of the uploaded pictures (card photos, logos, covers). Run by cron on Sundays as the user "bench".
#   File:      /srv/bench/backups/media_YYYYmmdd.tar.gz     Retention: 28 days (four weekly copies)
#   Off-server copy: BACKUP_REMOTE in /etc/bench-backup.env (same setting as backup_db.sh).
#   Not backed up here: the private export ZIPs (they are deleted after 24 hours on purpose).
# If the pictures live in a bucket (AWS_STORAGE_BUCKET_NAME is set) there is nothing to copy: switch on versioning in the bucket.
#
# RESTORE:   sudo -u bench tar -xzf /srv/bench/backups/media_<date>.tar.gz -C /srv/bench/data
set -euo pipefail
umask 077

[ -f /etc/bench-backup.env ] && . /etc/bench-backup.env
ENV_FILE=/srv/bench/app/backend/.env
MEDIA="${MEDIA_ROOT:-/srv/bench/data/media}"
DIR=/srv/bench/backups
STATE=/srv/bench/state
mkdir -p "$DIR" "$STATE"
FILE="$DIR/media_$(date +%Y%m%d).tar.gz"

fail() {
    echo "$(date -Is) media backup FAILED: $*" | tee "$DIR/LAST_FAILURE_MEDIA" >&2
    rm -f "$FILE"
    exit 1
}

if grep -qE '^AWS_STORAGE_BUCKET_NAME=.+' "$ENV_FILE" 2> /dev/null; then
    echo "$(date -Is) media is in a bucket: nothing to copy (use bucket versioning)"
    touch "$STATE/ok-backup-media"
    exit 0
fi
[ -d "$MEDIA" ] || fail "media folder $MEDIA does not exist"

tar -czf "$FILE" -C "$(dirname "$MEDIA")" "$(basename "$MEDIA")" || fail "tar"
tar -tzf "$FILE" > /dev/null || fail "the archive cannot be read back"

if [ -n "${BACKUP_REMOTE:-}" ]; then
    command -v rclone > /dev/null || fail "BACKUP_REMOTE is set but rclone is not installed"
    rclone copy "$FILE" "$BACKUP_REMOTE" || fail "copy to $BACKUP_REMOTE"
fi

find "$DIR" -name 'media_*.tar.gz' -mtime +28 -delete
rm -f "$DIR/LAST_FAILURE_MEDIA"
touch "$STATE/ok-backup-media"
echo "$(date -Is) media backup ok: $FILE ($(du -h "$FILE" | cut -f1))"
