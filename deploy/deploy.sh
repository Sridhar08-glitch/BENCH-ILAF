#!/usr/bin/env bash
# Deploy or update BENCH on the server. Run after every push:
#     sudo bash /srv/bench/app/deploy/deploy.sh            (branch main)
#     sudo BRANCH=release bash /srv/bench/app/deploy/deploy.sh
#
# Order: pull the branch -> install dependencies -> Django production check -> DATABASE BACKUP (a failed backup STOPS the
# deploy before anything changes) -> migrate -> collectstatic -> seed plans -> build the web app -> restart the API, check
# it, restart the web app, check it. If either health check fails the previous code (and the previous web build) is
# put back and the services restarted, so the site keeps working.
#
# Notes
#   * Database changes are NOT undone by a rollback. Write migrations so the previous code still works with them
#     (add columns, do not rename or drop in the same release).
#   * NEXT_PUBLIC_* values are baked into the web build: they come from /srv/bench/app/web/.env.production at build time.
#   * Hand edits on the server are saved as a patch under /srv/bench/hotfix-backups/ before the code is overwritten.
#   * Does NOT touch the other app on this server.
#   * SKIP_BACKUP=1 skips the backup on purpose (first deploy on an empty database only).
set -euo pipefail

APP_USER=bench
ROOT=/srv/bench
APP_DIR=$ROOT/app
BACKEND=$APP_DIR/backend
WEB=$APP_DIR/web
VENV=$BACKEND/.venv
BRANCH="${BRANCH:-main}"
STATE=$ROOT/state
HOTFIX=$ROOT/hotfix-backups
API_URL_LOCAL=http://127.0.0.1:8101/health/
WEB_URL_LOCAL=http://127.0.0.1:3101/

log() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m  ! %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31m!! %s\033[0m\n' "$*"; exit 1; }
as_app() { sudo -H -u "$APP_USER" "$@"; }

[ "$(id -u)" -eq 0 ] || { echo "Run as root: sudo bash $0"; exit 1; }
[ -f "$BACKEND/.env" ] || fail "Missing $BACKEND/.env (copy deploy/env.production.example and fill it in)."
[ -f "$WEB/.env.production" ] || fail "Missing $WEB/.env.production (copy deploy/env.web.production.example and fill it in)."
mkdir -p "$STATE" "$HOTFIX" "$ROOT/logs"
chown "$APP_USER:$APP_USER" "$STATE" "$HOTFIX" "$ROOT/logs"

FREE_MB=$(df -Pm "$ROOT" | awk 'NR==2 {print $4}')
[ "$FREE_MB" -ge 2048 ] || fail "Less than 2 GB free on $ROOT (${FREE_MB} MB). Free some space first (the web build needs room)."

wait_for() {
    # wait_for <url> <label> [seconds] ["codes"]: succeeds when the URL answers one of the codes (default: 200 only).
    local url="$1" label="$2" limit="${3:-60}" okcodes="${4:-200}" code="" i
    for i in $(seq 1 $((limit / 2))); do
        code=$(curl -s -o /dev/null -w '%{http_code}' -H "X-Forwarded-Proto: https" "$url" || true)
        case " $okcodes " in
            *" $code "*) echo "  $label answers HTTP $code (after $((i * 2)) s)"; return 0 ;;
        esac
        sleep 2
    done
    echo "  $label: HTTP ${code:-none} (gave up after ${limit} s)"
    return 1
}

PREVIOUS=$(as_app git -C "$APP_DIR" rev-parse HEAD)
WEB_BUILD_SAVED=0

rollback() {
    log "Rolling back to $PREVIOUS"
    as_app git -C "$APP_DIR" reset --hard "$PREVIOUS" || true
    as_app "$VENV/bin/pip" install --quiet -r "$BACKEND/requirements.txt" || true
    if [ "$WEB_BUILD_SAVED" = "1" ] && [ -d "$WEB/.next.prev" ]; then
        rm -rf "$WEB/.next"
        mv "$WEB/.next.prev" "$WEB/.next"
        WEB_BUILD_SAVED=0
    fi
    systemctl restart bench-api || true
    wait_for "$API_URL_LOCAL" "API (after rollback)" 60 || true
    systemctl restart bench-web || true
    wait_for "$WEB_URL_LOCAL" "web (after rollback)" 60 "200 301 302 307 308" || true
    rm -f "$STATE/deploying"
    fail "Deploy rolled back to $PREVIOUS. Look at: journalctl -u bench-api -n 100   and   journalctl -u bench-web -n 100"
}

trap 'rm -f "$STATE/deploying"' EXIT

log "Pull $BRANCH"
as_app git -C "$APP_DIR" fetch origin
if [ -n "$(as_app git -C "$APP_DIR" status --porcelain --untracked-files=no)" ]; then
    PATCH="$HOTFIX/server-edits-$(date +%Y%m%d-%H%M%S).patch"
    as_app git -C "$APP_DIR" diff > "$PATCH"
    warn "files were edited on the server; saved to $PATCH before they are overwritten"
fi
as_app git -C "$APP_DIR" checkout "$BRANCH"
as_app git -C "$APP_DIR" reset --hard "origin/$BRANCH"

log "Python dependencies"
as_app "$VENV/bin/pip" install --quiet -r "$BACKEND/requirements.txt"

log "Django system check (production settings)"
( cd "$BACKEND" && as_app "$VENV/bin/python" manage.py check --deploy --fail-level ERROR ) \
    || { as_app git -C "$APP_DIR" reset --hard "$PREVIOUS"; fail "Django check failed; code put back. Nothing was changed."; }

log "Database backup before migrating"
if [ "${SKIP_BACKUP:-0}" = "1" ]; then
    warn "SKIP_BACKUP=1: backup skipped on purpose"
else
    as_app "$APP_DIR/deploy/backup_db.sh" \
        || { as_app git -C "$APP_DIR" reset --hard "$PREVIOUS"; fail "The database backup FAILED, so nothing was migrated and nothing was restarted. Fix the backup (disk space? $APP_DIR/deploy/backup_db.sh) and run again."; }
fi

log "Migrations and static files (scheduled jobs pause meanwhile)"
touch "$STATE/deploying"
( cd "$BACKEND" && as_app "$VENV/bin/python" manage.py migrate --noinput ) || rollback
( cd "$BACKEND" && as_app "$VENV/bin/python" manage.py collectstatic --noinput --verbosity 0 ) || rollback
# seed_plans never overwrites prices edited in the admin; it only creates missing plans.
( cd "$BACKEND" && as_app "$VENV/bin/python" manage.py seed_plans ) || rollback
rm -f "$STATE/deploying"

log "Web app: dependencies and build (about 2 to 4 minutes; NEXT_PUBLIC_* values are baked in here)"
( cd "$WEB" && as_app npm ci --no-audit --no-fund ) || rollback
rm -rf "$WEB/.next.prev"
if [ -d "$WEB/.next" ]; then
    as_app cp -a "$WEB/.next" "$WEB/.next.prev"
    WEB_BUILD_SAVED=1
fi
( cd "$WEB" && as_app env NODE_ENV=production npm run build ) || rollback

log "Restart the API first, then the web app (one at a time)"
systemctl daemon-reload
systemctl restart bench-api
wait_for "$API_URL_LOCAL" "API /health/" 60 || rollback
systemctl restart bench-web
wait_for "$WEB_URL_LOCAL" "web app /" 60 "200 301 302 307 308" || rollback

log "Final check"
for svc in bench-api bench-web nginx postgresql redis-server; do
    printf "  %-14s %s\n" "$svc" "$(systemctl is-active "$svc" 2>/dev/null || echo unknown)"
done
rm -rf "$WEB/.next.prev"
log "Deployed $(as_app git -C "$APP_DIR" rev-parse --short HEAD) (previous was ${PREVIOUS:0:7})"
