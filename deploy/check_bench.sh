#!/usr/bin/env bash
# Read-only health report for BENCH. Changes nothing and prints no secrets (only the NAMES of settings).
#   bash /srv/bench/app/deploy/check_bench.sh              print the report
#   bash /srv/bench/app/deploy/check_bench.sh --mail       also e-mail it to ALERT_EMAIL when something is WARN or FAIL
#   bash /srv/bench/app/deploy/check_bench.sh --mail-daily same (used by cron once a day)
# Lines: [OK] fine, [WARN] look at it soon, [FAIL] fix now. Exit code: 0 all fine, 1 warnings, 2 failures.
# The latest report is also saved to /srv/bench/state/status.txt.
set -uo pipefail
# shellcheck source=deploy/bench_lib.sh
. "$(dirname "$(readlink -f "$0")")/bench_lib.sh"

MAIL=0
case "${1:-}" in --mail | --mail-daily) MAIL=1 ;; esac
mkdir -p "$BENCH_STATE" "$BENCH_LOGS"

OUT=$(mktemp)
FAILS=0
WARNS=0
ok() { echo "[OK]   $*" >> "$OUT"; }
warn() { echo "[WARN] $*" >> "$OUT"; WARNS=$((WARNS + 1)); }
bad() { echo "[FAIL] $*" >> "$OUT"; FAILS=$((FAILS + 1)); }
head_() { echo "" >> "$OUT"; echo "== $* ==" >> "$OUT"; }
age_min() { # minutes since a file was last modified, or empty when it does not exist
    [ -e "$1" ] || return 0
    echo $(( ($(date +%s) - $(stat -c %Y "$1")) / 60 ))
}

echo "BENCH status $(date -u '+%Y-%m-%d %H:%M UTC') on $(hostname)" >> "$OUT"

head_ "services"
for u in bench-api bench-web nginx postgresql redis-server; do
    systemctl list-unit-files "$u.service" 2> /dev/null | grep -q "^$u.service" || { [ "$u" = redis-server ] && continue; warn "$u: unit not installed"; continue; }
    if systemctl is-active --quiet "$u"; then ok "$u is running"; else bad "$u is NOT running (sudo systemctl restart $u)"; fi
    systemctl is-enabled --quiet "$u" 2> /dev/null || warn "$u does not start on boot (sudo systemctl enable $u)"
done

head_ "web and API answers"
code=$(curl -s -o /dev/null -m 8 -w '%{http_code}' -H "X-Forwarded-Proto: https" http://127.0.0.1:8101/health/ || true)
[ "$code" = "200" ] && ok "API /health/ answers 200 (database reachable)" || bad "API /health/ answered ${code:-nothing}"
code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' http://127.0.0.1:3101/ || true)
case "$code" in 200 | 301 | 302 | 307 | 308) ok "web app answers $code" ;; *) bad "web app answered ${code:-nothing}" ;; esac
API_PUBLIC=$(env_value API_BASE_URL)
if [ -n "$API_PUBLIC" ]; then
    code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$API_PUBLIC/health/" || true)
    [ "$code" = "200" ] && ok "public $API_PUBLIC/health/ answers 200 (nginx and certificate fine)" || bad "public $API_PUBLIC/health/ answered ${code:-nothing}"
    HOST=$(echo "$API_PUBLIC" | sed -e 's#^[a-z]*://##' -e 's#/.*##')
    END=$(echo | timeout 10 openssl s_client -servername "$HOST" -connect "$HOST:443" 2> /dev/null | openssl x509 -noout -enddate 2> /dev/null | cut -d= -f2)
    if [ -n "$END" ]; then
        DAYS=$(( ($(date -d "$END" +%s) - $(date +%s)) / 86400 ))
        if [ "$DAYS" -lt 7 ]; then bad "TLS certificate expires in $DAYS days (certbot renew?)"; elif [ "$DAYS" -lt 21 ]; then warn "TLS certificate expires in $DAYS days"; else ok "TLS certificate valid for $DAYS more days"; fi
    else
        warn "could not read the TLS certificate of $HOST"
    fi
else
    warn "API_BASE_URL is empty in .env"
fi

head_ "disk and memory"
USED=$(df -P /srv | awk 'NR==2 {gsub("%","",$5); print $5}')
if [ "$USED" -ge 92 ]; then bad "disk /srv is ${USED}% full"; elif [ "$USED" -ge 80 ]; then warn "disk /srv is ${USED}% full"; else ok "disk /srv is ${USED}% full"; fi
AVAIL=$(free -m | awk '/^Mem:/ {print $7}')
if [ "$AVAIL" -lt 400 ]; then bad "only ${AVAIL} MB memory available"; elif [ "$AVAIL" -lt 1000 ]; then warn "only ${AVAIL} MB memory available"; else ok "${AVAIL} MB memory available"; fi
LOAD=$(cut -d' ' -f1 /proc/loadavg); CORES=$(nproc)
awk -v l="$LOAD" -v c="$CORES" 'BEGIN {exit !(l > c * 1.5)}' && warn "load average $LOAD on $CORES cores" || ok "load average $LOAD on $CORES cores"

head_ "backups"
LATEST=$(ls -1t /srv/bench/backups/bench_*.dump 2> /dev/null | head -n 1)
if [ -z "$LATEST" ]; then
    bad "no database backup exists yet"
else
    A=$(age_min "$LATEST")
    if [ "$A" -gt 3000 ]; then bad "newest database backup is $((A / 60)) hours old"; elif [ "$A" -gt 1560 ]; then warn "newest database backup is $((A / 60)) hours old"; else ok "newest database backup is $((A / 60)) hours old ($(du -h "$LATEST" | cut -f1))"; fi
fi
[ -e /srv/bench/backups/LAST_FAILURE ] && bad "last backup failed: $(cat /srv/bench/backups/LAST_FAILURE)"
if grep -qE '^AWS_STORAGE_BUCKET_NAME=.+' "$BENCH_ENV" 2> /dev/null; then
    ok "pictures are in a bucket (no media backup needed)"
else
    M=$(ls -1t /srv/bench/backups/media_*.tar.gz 2> /dev/null | head -n 1)
    if [ -z "$M" ]; then warn "no media backup yet (runs Sundays)"; else A=$(age_min "$M"); [ "$A" -gt 12000 ] && warn "newest media backup is $((A / 1440)) days old" || ok "newest media backup is $((A / 1440)) days old"; fi
    [ -e /srv/bench/backups/LAST_FAILURE_MEDIA ] && bad "last media backup failed: $(cat /srv/bench/backups/LAST_FAILURE_MEDIA)"
fi
if [ -f /etc/bench-backup.env ] && grep -qE '^BACKUP_REMOTE=.+' /etc/bench-backup.env 2> /dev/null; then ok "backups are copied off this server"; else warn "backups exist only on this server (set BACKUP_REMOTE in /etc/bench-backup.env)"; fi

head_ "scheduled jobs (last successful run)"
# name:maximum minutes since the last success
for spec in deliver_webhooks:10 sync_crm:10 fetch_support_mail:10 support_tick:10 process_data_requests:30 cleanup_data_exports:180 purge_deleted_accounts:2160 expire_subscriptions:2160 flushexpiredtokens:2160 send_renewal_reminders:2160 send_weekly_reports:12960 prune_api_idempotency:2160 send_announcements:30 expire_support_views:30 prune_back_office:2160 send_daily_summary:180 prune_security:2160; do
    name=${spec%%:*}; max=${spec##*:}
    if [ -e "$BENCH_STATE/fail-$name" ]; then bad "job $name failed last time: $(cut -c1-200 "$BENCH_STATE/fail-$name")"; continue; fi
    A=$(age_min "$BENCH_STATE/ok-$name")
    if [ -z "$A" ]; then warn "job $name has never run yet"; elif [ "$A" -gt "$max" ]; then bad "job $name last succeeded $A minutes ago (limit $max): is cron running? /etc/cron.d/bench present?"; else ok "job $name ran $A minutes ago"; fi
done

head_ "queues (webhooks, data requests)"
Q=$(cd "$BENCH_BACKEND" && timeout 60 "$BENCH_PY" manage.py shell -c "
from datetime import timedelta
from django.utils import timezone
from leads.models import WebhookDelivery
from privacy.models import DataRequest
now = timezone.now()
print('overdue_webhooks=%d' % WebhookDelivery.objects.filter(status='pending', next_attempt_at__lt=now - timedelta(minutes=15)).count())
print('failed_webhooks_24h=%d' % WebhookDelivery.objects.filter(status='failed', created_at__gte=now - timedelta(hours=24)).count())
print('stuck_exports=%d' % DataRequest.objects.filter(kind='export', status__in=['pending', 'processing'], requested_at__lt=now - timedelta(minutes=30)).count())
print('failed_exports_7d=%d' % DataRequest.objects.filter(kind='export', status='failed', requested_at__gte=now - timedelta(days=7)).count())
print('overdue_deletions=%d' % DataRequest.objects.filter(kind='delete', status='pending', scheduled_for__lt=now - timedelta(days=1)).count())
print('requests_due_soon=%d' % DataRequest.objects.filter(status__in=['pending', 'processing'], due_at__lt=now + timedelta(days=5)).count())
" 2> /dev/null)
if [ -z "$Q" ]; then
    bad "could not query the database from Django"
else
    get() { echo "$Q" | grep "^$1=" | cut -d= -f2; }
    n=$(get overdue_webhooks);     [ "${n:-0}" -gt 0 ] && bad "$n webhook deliveries are overdue by more than 15 minutes" || ok "no overdue webhook deliveries"
    n=$(get failed_webhooks_24h);  [ "${n:-0}" -gt 10 ] && warn "$n webhook deliveries failed in the last 24 hours" || ok "failed webhook deliveries in 24 h: ${n:-0}"
    n=$(get stuck_exports);        [ "${n:-0}" -gt 0 ] && bad "$n data exports are waiting for more than 30 minutes" || ok "no stuck data exports"
    n=$(get failed_exports_7d);    [ "${n:-0}" -gt 0 ] && warn "$n data exports failed in the last 7 days (admin > Data requests)" || ok "no failed data exports"
    n=$(get overdue_deletions);    [ "${n:-0}" -gt 0 ] && bad "$n account deletions are overdue (purge_deleted_accounts not running?)" || ok "no overdue account deletions"
    n=$(get requests_due_soon);    [ "${n:-0}" -gt 0 ] && warn "$n privacy requests have a legal deadline within 5 days" || ok "no privacy request near its deadline"
fi
cd "$BENCH_BACKEND" && if timeout 60 "$BENCH_PY" manage.py migrate --check > /dev/null 2>&1; then ok "no pending database migrations"; else warn "pending migrations (or the check failed): run deploy.sh"; fi

head_ "configuration (names only)"
v=$(env_value DEBUG); case "${v,,}" in true | 1 | yes | on) bad "DEBUG is on" ;; *) ok "DEBUG is off" ;; esac
v=$(env_value CARDS_DEV_ACTIVATE); case "${v,,}" in true | 1 | yes | on) bad "CARDS_DEV_ACTIVATE is on (free plans for everybody)" ;; *) ok "CARDS_DEV_ACTIVATE is off" ;; esac
v=$(env_value HTTPS_ONLY); case "${v,,}" in true | 1 | yes | on) ok "HTTPS_ONLY is on" ;; *) bad "HTTPS_ONLY is off" ;; esac
v=$(env_value EMAIL_HOST); [ -n "$v" ] && ok "EMAIL_HOST is set" || bad "EMAIL_HOST is empty: e-mails are not delivered"
v=$(env_value REDIS_URL); [ -n "$v" ] && ok "REDIS_URL is set (shared rate limits)" || warn "REDIS_URL is empty: rate limits are per worker"
v=$(env_value ALERT_EMAIL); { [ -n "$v" ] && [ "$v" != "CHANGE_ME@example.com" ]; } && ok "ALERT_EMAIL is set" || warn "ALERT_EMAIL is not set: no alert e-mails"
v=$(env_value SENTRY_DSN); [ -n "$v" ] && ok "error reporting (Sentry) is on" || warn "no error reporting: errors only appear in the journal"
for k in MEDIA_ROOT EXPORT_ROOT; do d=$(env_value $k); if [ -z "$d" ]; then warn "$k not set"; elif [ -d "$d" ] && [ -w "$d" ]; then ok "$k exists and is writable"; else bad "$k=$d is missing or not writable"; fi; done

head_ "errors"
if command -v journalctl > /dev/null; then
    n=$(journalctl -u bench-api -u bench-web --since "24 hours ago" -p err --no-pager -q 2> /dev/null | wc -l)
    [ "$n" -gt 50 ] && warn "$n error lines in the journal in the last 24 hours (journalctl -u bench-api -p err)" || ok "$n error lines in the journal in the last 24 hours"
fi

{
    echo ""
    echo "Summary: $FAILS failure(s), $WARNS warning(s)"
} >> "$OUT"
cat "$OUT"
cp "$OUT" "$BENCH_STATE/status.txt"

if [ "$MAIL" = "1" ] && [ $((FAILS + WARNS)) -gt 0 ]; then
    SUBJECT="BENCH status: $FAILS failure(s), $WARNS warning(s)"
    send_alert "$SUBJECT" "$(grep -E '^\[(WARN|FAIL)\]|^Summary|^BENCH status' "$OUT")" || echo "(e-mail not sent: ALERT_EMAIL or SMTP not set up; the report is in $BENCH_STATE/status.txt)"
fi
rm -f "$OUT"
[ "$FAILS" -gt 0 ] && exit 2
[ "$WARNS" -gt 0 ] && exit 1
exit 0
