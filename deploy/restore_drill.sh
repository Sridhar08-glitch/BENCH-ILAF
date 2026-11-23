#!/usr/bin/env bash
# Restore drill: proves a backup can really be restored, WITHOUT touching the live database.
#   sudo bash /srv/bench/app/deploy/restore_drill.sh                 (uses the newest dump)
#   sudo bash /srv/bench/app/deploy/restore_drill.sh /srv/bench/backups/bench_20261122_023000.dump
# It restores into a scratch database called bench_drill, runs smoke queries (tables exist, users and cards can be
# counted, the newest migration is present), prints the result and ALWAYS drops the scratch database again.
# Do this once after the first backup and then every month.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Run as root: sudo bash $0"; exit 1; }
DIR=/srv/bench/backups
SCRATCH=bench_drill
DUMP="${1:-$(ls -1t "$DIR"/bench_*.dump 2> /dev/null | head -n 1 || true)}"
[ -n "$DUMP" ] && [ -s "$DUMP" ] || { echo "No dump found in $DIR. Run backup_db.sh first."; exit 1; }

pg() { sudo -u postgres "$@"; }
cleanup() { pg dropdb --if-exists "$SCRATCH" > /dev/null 2>&1 || true; }
trap cleanup EXIT

echo "Dump:     $DUMP ($(du -h "$DUMP" | cut -f1), made $(date -r "$DUMP" '+%Y-%m-%d %H:%M'))"
cleanup
pg createdb "$SCRATCH"
# The dump is fed through stdin so the postgres user needs no read access to the backup folder.
# Errors about roles that do not exist on a scratch database are harmless with --no-owner.
pg pg_restore --no-owner --exit-on-error -d "$SCRATCH" < "$DUMP"

q() { pg psql -d "$SCRATCH" -At -c "$1"; }
TABLES=$(q "select count(*) from information_schema.tables where table_schema='public'")
USERS=$(q "select count(*) from accounts_user")
CARDS=$(q "select count(*) from cards_card")
WORKSPACES=$(q "select count(*) from workspaces_workspace")
LEADS=$(q "select count(*) from leads_lead")
LAST_MIG=$(q "select app || '.' || name from django_migrations order by id desc limit 1")
PLANS=$(q "select count(*) from billing_plan")

echo "Tables:      $TABLES"
echo "Users:       $USERS"
echo "Workspaces:  $WORKSPACES"
echo "Cards:       $CARDS"
echo "Leads:       $LEADS"
echo "Plans:       $PLANS"
echo "Last migration applied: $LAST_MIG"

[ "$TABLES" -gt 20 ] || { echo "DRILL FAILED: far too few tables in the restored copy."; exit 1; }
[ "$PLANS" -ge 1 ] || echo "WARNING: no plans in the dump (fine only on a brand-new empty system)."
echo "DRILL OK: the backup restores and answers queries. The scratch database is being removed."
