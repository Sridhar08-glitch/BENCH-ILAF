#!/usr/bin/env bash
# Runs one scheduled Django command so that two runs of the same job never overlap.
#   usage:  run_job.sh <job-name> <manage.py arguments...>
#   example: run_job.sh deliver_webhooks deliver_webhooks
# Called from /etc/cron.d/bench as the user "bench". Environment: QUIET=1 logs only failures, JOB_TIMEOUT=seconds (default 900).
#
# What it leaves behind (used by check_bench.sh to notice a job that stopped running):
#   /srv/bench/state/ok-<job-name>     touched after every successful run
#   /srv/bench/state/fail-<job-name>   written after a failed run, removed after the next success
#   /srv/bench/logs/jobs.log           one line per run (failures always, successes unless QUIET=1)
# A run is skipped (not queued) while the previous run of the same job is still going, and while deploy.sh is migrating.
set -uo pipefail

BACKEND=/srv/bench/app/backend
STATE=/srv/bench/state
LOGS=/srv/bench/logs

[ "$#" -ge 2 ] || { echo "usage: run_job.sh <job-name> <manage.py arguments...>" >&2; exit 2; }
NAME="$1"; shift
mkdir -p "$STATE" "$LOGS"

# A deploy is changing the database: skip quietly, the next scheduled run catches up.
[ -e "$STATE/deploying" ] && exit 0

exec 9>"$STATE/lock-$NAME"
flock -n 9 || exit 0

cd "$BACKEND" || exit 1
STARTED=$(date +%s)
OUT=$(timeout "${JOB_TIMEOUT:-900}" "$BACKEND/.venv/bin/python" manage.py "$@" 2>&1)
RC=$?
LINE="$(date -u +%Y-%m-%dT%H:%M:%SZ) $NAME rc=$RC $(echo "$OUT" | tail -n 5 | tr '\n' ' ')"
# "<epoch seconds at the end> <exit code> <seconds it took>": the staff Jobs tab shows the duration from this file.
echo "$(date +%s) $RC $(( $(date +%s) - STARTED ))" > "$STATE/last-$NAME"

if [ "$RC" -eq 0 ]; then
    touch "$STATE/ok-$NAME"
    rm -f "$STATE/fail-$NAME"
    [ "${QUIET:-0}" = "1" ] || echo "$LINE" >> "$LOGS/jobs.log"
else
    echo "$LINE" > "$STATE/fail-$NAME"
    echo "$LINE" >> "$LOGS/jobs.log"
fi
exit "$RC"
