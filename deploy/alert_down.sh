#!/usr/bin/env bash
# Down-alarm, run every minute by cron as the user "bench" (/etc/cron.d/bench).
# Checks three things: the API health address on this machine, the web app on this machine, and the public https API address
# (so nginx and the certificate are covered too). When a check fails TWICE IN A ROW an e-mail goes to ALERT_EMAIL (set in
# /srv/bench/app/backend/.env); one more e-mail follows when everything is back. One mail per outage, never a flood.
# Without a working mail setup the message is still written to /srv/bench/logs/alerts.log and the system log.
# During a deploy (state file "deploying") checks are skipped, because restarts are expected then.
set -uo pipefail
# shellcheck source=deploy/bench_lib.sh
. "$(dirname "$(readlink -f "$0")")/bench_lib.sh"

mkdir -p "$BENCH_STATE"
[ -e "$BENCH_STATE/deploying" ] && exit 0

COUNT_FILE=$BENCH_STATE/down-count
ALERTED_FILE=$BENCH_STATE/down-alerted
PUBLIC_API=$(env_value API_BASE_URL)

problems=""
code=$(curl -s -o /dev/null -m 8 -w '%{http_code}' -H "X-Forwarded-Proto: https" http://127.0.0.1:8101/health/ || true)
[ "$code" = "200" ] || problems="$problems API on this machine answered ${code:-nothing} instead of 200;"
code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' http://127.0.0.1:3101/ || true)
case "$code" in 200 | 301 | 302 | 307 | 308) ;; *) problems="$problems web app on this machine answered ${code:-nothing};" ;; esac
if [ -n "$PUBLIC_API" ]; then
    code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$PUBLIC_API/health/" || true)
    [ "$code" = "200" ] || problems="$problems public address $PUBLIC_API/health/ answered ${code:-nothing};"
fi

if [ -z "$problems" ]; then
    if [ -e "$ALERTED_FILE" ]; then
        send_alert "BENCH is back up" "All checks pass again at $(date -u '+%Y-%m-%d %H:%M UTC')." || true
        rm -f "$ALERTED_FILE"
    fi
    rm -f "$COUNT_FILE"
    exit 0
fi

COUNT=$(( $(cat "$COUNT_FILE" 2> /dev/null || echo 0) + 1 ))
echo "$COUNT" > "$COUNT_FILE"
if [ "$COUNT" -ge 2 ] && [ ! -e "$ALERTED_FILE" ]; then
    send_alert "BENCH is DOWN" "Failed twice in a row at $(date -u '+%Y-%m-%d %H:%M UTC'):$problems
First steps: sudo bash /srv/bench/app/deploy/check_bench.sh   then   journalctl -u bench-api -n 50   and   journalctl -u bench-web -n 50" || true
    touch "$ALERTED_FILE"
fi
exit 0
