#!/usr/bin/env bash
# Shared helpers for check_bench.sh and alert_down.sh (sourced, never run on its own).
BENCH_ROOT=/srv/bench
BENCH_BACKEND=$BENCH_ROOT/app/backend
BENCH_STATE=$BENCH_ROOT/state
BENCH_LOGS=$BENCH_ROOT/logs
BENCH_ENV=$BENCH_BACKEND/.env
BENCH_PY=$BENCH_BACKEND/.venv/bin/python

# env_value NAME: the value of NAME in the backend .env file (empty when missing). Values are never printed by the scripts.
env_value() {
    grep -E "^$1=" "$BENCH_ENV" 2> /dev/null | head -n 1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//'
}

# send_alert "subject" "body": e-mails ALERT_EMAIL (from the backend .env) through the app's SMTP settings.
# If no address is set or sending fails, the message is written to the alerts log and to the system log instead,
# so a clear record always exists. Returns 0 when the e-mail was handed to the mail server.
send_alert() {
    local subject="$1" body="$2" to
    mkdir -p "$BENCH_LOGS"
    to=$(env_value ALERT_EMAIL)
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) ALERT: $subject | $body" >> "$BENCH_LOGS/alerts.log"
    command -v logger > /dev/null && logger -t bench-alert -p user.crit "$subject"
    [ -n "$to" ] && [ "$to" != "CHANGE_ME@example.com" ] || return 1
    ( cd "$BENCH_BACKEND" && ALERT_SUBJECT="$subject" ALERT_BODY="$body" ALERT_TO="$to" \
        "$BENCH_PY" - << 'PYEOF'
import os
import django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "ilaf.settings")
django.setup()
from django.core.mail import send_mail
send_mail(os.environ["ALERT_SUBJECT"], os.environ["ALERT_BODY"], None, [os.environ["ALERT_TO"]], fail_silently=False)
PYEOF
    ) > /dev/null 2>&1
}
