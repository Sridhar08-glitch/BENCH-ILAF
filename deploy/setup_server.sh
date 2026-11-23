#!/usr/bin/env bash
# One-time server preparation for BENCH. Safe to run again (every step checks first). Run as root AFTER the code has been
# cloned to /srv/bench/app (README-DEPLOY.md, steps 1 to 3):
#     sudo bash /srv/bench/app/deploy/setup_server.sh
#
# It installs what is missing, creates the database role and database "bench", installs the systemd units,
# the log rotation and the nginx building blocks. It does NOT touch the other app on this server: it never edits or restarts
# anything that is not named "bench", and it only RELOADS nginx (after nginx -t passes), never restarts it.
# It does NOT enable the nginx server blocks (they need your host names and the certificate: README-DEPLOY.md, step 7).
set -euo pipefail

ROOT=/srv/bench
APP=$ROOT/app
log() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "Run as root: sudo bash $0"; exit 1; }
[ -d "$APP/deploy" ] || { echo "$APP/deploy not found: clone the repository to $APP first."; exit 1; }

log "System packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl ca-certificates build-essential python3 python3-venv python3-dev \
    nginx certbot postgresql postgresql-client redis-server rsync logrotate cron openssl > /dev/null

log "Node.js 20 or newer (needed by the web app)"
if command -v node > /dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ]; then
    echo "  found node $(node -v)"
else
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y -qq nodejs > /dev/null
    echo "  installed node $(node -v)"
fi

log "User and folders"
id bench > /dev/null 2>&1 || useradd --system --create-home --home-dir "$ROOT" --shell /bin/bash bench
usermod -aG systemd-journal bench
mkdir -p "$ROOT"/{data/media,data/private_exports,backups,logs,state,hotfix-backups}
chown -R bench:bench "$ROOT"
chmod 750 "$ROOT"
chmod 700 "$ROOT/data/private_exports" "$ROOT/backups"
# nginx must read the pictures and the built web files: it needs to walk into /srv/bench and read data/media.
usermod -aG bench www-data
chmod 750 "$ROOT/data" "$ROOT/data/media"
chmod g+x "$ROOT"

log "PostgreSQL role and database (socket login, no password: the Linux user bench is the database user bench)"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='bench'" | grep -q 1 || sudo -u postgres createuser bench
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='bench'" | grep -q 1 || sudo -u postgres createdb -O bench -E UTF8 bench
echo "  database bench ready"

log "Python environment"
[ -x "$APP/backend/.venv/bin/python" ] || sudo -u bench python3 -m venv "$APP/backend/.venv"
sudo -u bench "$APP/backend/.venv/bin/pip" install --quiet --upgrade pip

log "systemd units"
cp "$APP/deploy/systemd/bench-api.service" "$APP/deploy/systemd/bench-web.service" "$APP/deploy/systemd/bench.target" /etc/systemd/system/
systemctl daemon-reload
systemctl enable bench-api bench-web bench.target > /dev/null 2>&1
echo "  units installed and enabled (they start at the first deploy)"

log "Log rotation and script permissions (the cron file is installed last, README-DEPLOY.md step 11)"
chmod +x "$APP"/deploy/*.sh
cat > /etc/logrotate.d/bench << 'EOF'
/srv/bench/logs/*.log {
    weekly
    rotate 8
    compress
    missingok
    notifempty
    copytruncate
}
EOF
[ -f /etc/bench-backup.env ] || { printf '# BACKUP_REMOTE=remote:bucket/bench   (an rclone remote; see backup_db.sh)\n' > /etc/bench-backup.env; chmod 644 /etc/bench-backup.env; }

log "nginx building blocks (not enabled yet)"
cp "$APP/deploy/nginx/bench-http.conf" /etc/nginx/conf.d/bench-http.conf
mkdir -p /etc/nginx/snippets /var/www/html
cp "$APP/deploy/nginx/bench-proxy.conf" /etc/nginx/snippets/bench-proxy.conf
cp "$APP/deploy/nginx/bench-web-proxy.conf" /etc/nginx/snippets/bench-web-proxy.conf
cp "$APP/deploy/nginx/bench-web.conf" "$APP/deploy/nginx/bench-api.conf" "$APP/deploy/nginx/bench-bootstrap.conf" /etc/nginx/sites-available/
if nginx -t > /dev/null 2>&1; then
    systemctl reload nginx
    echo "  nginx configuration is valid and reloaded"
else
    echo "  WARNING: nginx -t failed. Run it to see why. Nothing was reloaded."
    nginx -t || true
fi

log "Done"
echo "Next: README-DEPLOY.md step 5 (the two .env files), then step 6 (first deploy)."
