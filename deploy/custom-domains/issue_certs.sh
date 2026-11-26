#!/usr/bin/env bash
# BENCH custom domains, nginx variant: get a Let's Encrypt certificate for every verified, Enterprise-live customer domain that has none
# yet, and remove the certificate of a domain that is no longer served. NOT needed with Caddy (it does this by itself).
#
# Run by cron every 10 minutes (see the line at the end of deploy/cron/bench-cron, commented out until you choose the nginx variant):
#     */10 * * * *   root  /srv/bench/app/deploy/custom-domains/issue_certs.sh >> /srv/bench/logs/custom-certs.log 2>&1
# Needs: certbot, nginx with deploy/nginx/bench-customdomains.conf, the web root /var/www/html answering /.well-known/acme-challenge/.
#
# Safety:
#   - Only names printed by `manage.py list_custom_domains` (verified in DNS AND company Enterprise-live) are ever requested.
#   - At most MAX_NEW new certificates per run (default 5) so a burst cannot reach Let's Encrypt's limits
#     (50 new certificates per registered domain per week, 300 new orders per account per 3 hours, 5 failed validations per hour).
#   - A failed name is not retried for FAIL_BACKOFF_HOURS (default 6): the marker file lives in $STATE.
#   - Set STAGING=1 to use Let's Encrypt's staging service (browsers will warn; use it for the first test).
set -euo pipefail

APP=${APP:-/srv/bench/app}
BACKEND=${BACKEND:-$APP/backend}
PY=${PY:-$BACKEND/.venv/bin/python}
STATE=${STATE:-/srv/bench/state/custom-certs}
WEBROOT=${WEBROOT:-/var/www/html}
EMAIL=${EMAIL:?set EMAIL to the address Let's Encrypt may write to}
MAX_NEW=${MAX_NEW:-5}
FAIL_BACKOFF_HOURS=${FAIL_BACKOFF_HOURS:-6}
STAGING=${STAGING:-0}
LIVE=/etc/letsencrypt/live

mkdir -p "$STATE"
cd "$BACKEND"

# The domains that must have a certificate (one per line, lower case). A failure here stops the script before it changes anything.
wanted=$(sudo -u bench "$PY" manage.py list_custom_domains)
new=0
reload=0

while IFS= read -r domain; do
  [ -z "$domain" ] && continue
  # Never trust output blindly: a name goes to a shell command, so it must look like a host name.
  if ! [[ "$domain" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]]; then
    echo "skip (not a host name): $domain"
    continue
  fi
  if [ -s "$LIVE/$domain/fullchain.pem" ]; then
    continue
  fi
  if [ "$new" -ge "$MAX_NEW" ]; then
    echo "limit of $MAX_NEW new certificates per run reached; $domain waits for the next run"
    continue
  fi
  marker="$STATE/failed-$domain"
  if [ -f "$marker" ] && [ -n "$(find "$marker" -mmin -$((FAIL_BACKOFF_HOURS * 60)) 2>/dev/null)" ]; then
    echo "skip (failed recently): $domain"
    continue
  fi
  args=(certonly --webroot -w "$WEBROOT" -d "$domain" --cert-name "$domain" --non-interactive --agree-tos -m "$EMAIL" --keep-until-expiring)
  [ "$STAGING" = "1" ] && args+=(--staging)
  echo "requesting a certificate for $domain"
  if certbot "${args[@]}"; then
    rm -f "$marker"
    reload=1
  else
    touch "$marker"
    echo "certbot failed for $domain (DNS not pointing here yet? port 80 blocked?)"
  fi
  new=$((new + 1))
done <<< "$wanted"

# Remove certificates of customer domains that are no longer served (removed, expired plan, released). Certificates are named after
# the domain; the Bench host's own certificate (named "bench") is never touched.
if [ -d "$LIVE" ]; then
  for dir in "$LIVE"/*/; do
    name=$(basename "$dir")
    [ "$name" = "README" ] || [ "$name" = "bench" ] && continue
    marker_file="$STATE/managed-$name"
    # Only remove what this script requested itself (it leaves a marker when it succeeds below).
    [ -f "$marker_file" ] || continue
    if ! grep -qxF "$name" <<< "$wanted"; then
      echo "no longer served, deleting certificate: $name"
      certbot delete --cert-name "$name" --non-interactive || true
      rm -f "$marker_file"
      reload=1
    fi
  done
  while IFS= read -r domain; do
    [ -n "$domain" ] && [ -s "$LIVE/$domain/fullchain.pem" ] && touch "$STATE/managed-$domain"
  done <<< "$wanted"
fi

if [ "$reload" = "1" ]; then
  nginx -t && systemctl reload nginx
fi
