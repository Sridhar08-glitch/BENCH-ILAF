# First run on PostgreSQL (VPS)

Why this exists: every test so far ran on SQLite. PostgreSQL is stricter (text length is enforced, some locks are refused, date and
time-zone functions differ), so the first run on it must be done on purpose, on a scratch database, BEFORE any customer data exists.
A static review of the backend was done (section 6); this list is what has to be run to prove it.

The machine that wrote this had no PostgreSQL, so nothing below has been executed yet. Run it top to bottom. Stop at the first [FAIL].
Lines starting with `sudo` are typed on the VPS. `$` marks a command whose output you read.

## 1. Database and user

```
sudo -u postgres psql -tAc "SELECT version()"                         # 14 or newer; the CI uses 16
sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='bench'" | grep -q 1 || sudo -u postgres createuser bench
sudo -u postgres psql -c "ALTER ROLE bench WITH PASSWORD 'CHOOSE-A-LONG-PASSWORD'"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='bench'" | grep -q 1 || sudo -u postgres createdb -O bench -E UTF8 bench
```

The live service connects over the local socket (`DATABASE_URL=postgres:///bench`, as in `env.production.example`). The test run needs a
password because it connects over TCP and must be allowed to create the throw-away test databases:

```
sudo -u postgres psql -c "ALTER ROLE bench CREATEDB"                  # only for the test run, removed again in section 3
```

## 2. Migrate a fresh database

Use a scratch database first, not the live one:

```
sudo -u postgres createdb -O bench -E UTF8 bench_scratch
cd /srv/bench/app/backend
export DATABASE_URL="postgres://bench:CHOOSE-A-LONG-PASSWORD@127.0.0.1:5432/bench_scratch"
export DEBUG=true SECRET_KEY=scratch-only-0123456789abcdef0123456789abcdef
sudo -E -u bench .venv/bin/python manage.py migrate --noinput          # every migration must say OK
sudo -E -u bench .venv/bin/python manage.py migrate --noinput          # second run: "No migrations to apply"
sudo -E -u bench .venv/bin/python manage.py seed_plans
sudo -E -u bench .venv/bin/python manage.py makemigrations --check --dry-run    # "No changes detected"
```

Go backwards once, to prove the data migrations can be undone (`cards`, `workspaces`, `billing`, `leads` have data migrations):

```
sudo -E -u bench .venv/bin/python manage.py migrate cards 0001
sudo -E -u bench .venv/bin/python manage.py migrate cards
```

## 3. The whole test suite on PostgreSQL

The settings read `DATABASE_URL` (through `dj_database_url`), and no test names SQLite, so the same suite runs on PostgreSQL unchanged.
Django creates and removes its own `test_bench...` databases:

```
cd /srv/bench/app/backend
export DATABASE_URL="postgres://bench:CHOOSE-A-LONG-PASSWORD@127.0.0.1:5432/bench"
export DEBUG=true SECRET_KEY=test-only-0123456789abcdef0123456789abcdef
sudo -E -u bench .venv/bin/python manage.py test --parallel 4 --noinput 2>&1 | tee /tmp/pg-tests.txt
tail -5 /tmp/pg-tests.txt                                              # want: OK (and the same number of tests as on SQLite)
sudo -u postgres psql -c "ALTER ROLE bench NOCREATEDB"                 # take the permission away again
```

Do not run it with `--parallel` more than the number of CPU cores. If a test fails only on PostgreSQL, copy the first error and
send it to the developer; the usual causes are listed in section 6.

## 4. Analytics with a non-UTC time zone on PostgreSQL

The charts cut days, weeks and months in the viewer's time zone (`TruncDate`, `TruncWeek`, `TruncMonth`, `ExtractHour` with `tzinfo`).
After the scratch database has data (run `deploy/loadtest/seed.py`, see `deploy/loadtest/README.md`) call each form once and check for HTTP 200:

```
API=http://127.0.0.1:8101/api/v1       # the scratch API, or the live one after the live check below
TOKEN=...                               # POST $API/auth/login, take "access"
WS=...                                  # GET $API/me/workspaces, take the company "id"
for tz in UTC Asia/Qatar America/Los_Angeles Pacific/Auckland; do
  for q in "days=7" "days=90&group=week" "days=400&group=month"; do
    printf "%s %s -> " "$tz" "$q"
    curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $TOKEN" "$API/workspaces/$WS/analytics?$q&tz=$tz"
  done
done
```

All twelve lines must say `200`. A `500` means the time-zone cut failed: send the line of the error from `journalctl -u bench-api -n 50`.

Roll-up job (the nightly `prune_analytics` aggregation), on the scratch database:

```
sudo -E -u bench .venv/bin/python manage.py prune_analytics --dry-run
sudo -E -u bench .venv/bin/python manage.py prune_analytics            # twice: the second run must change nothing
```

## 5. The live database and the health report

Only after sections 2 to 4 are clean:

```
sudo systemctl stop bench-api bench-web
sudo -u bench bash -c 'cd /srv/bench/app/backend && set -a && . ./.env && set +a && .venv/bin/python manage.py migrate --noinput'
sudo -u bench bash -c 'cd /srv/bench/app/backend && set -a && . ./.env && set +a && .venv/bin/python manage.py seed_plans'
sudo systemctl start bench-api bench-web
bash /srv/bench/app/deploy/check_bench.sh                              # want: no [FAIL]
curl -s https://api.YOURDOMAIN/health/                                  # {"status": "ok", "database": "ok"}
sudo -u postgres dropdb bench_scratch
```

Then one real round through the website: register, buy nothing, create a company, invite a second e-mail, accept it in a private window,
publish a card, scan its QR code. Then run the browser smoke tests against the live site from your laptop
(`web/e2e/README.md`, "Against a real server") only with a staging copy; they create test accounts.

## 6. What the static review found (already fixed or still to watch)

Fixed in code:

| Where | Problem on PostgreSQL | Fix |
|---|---|---|
| `backend/operations/changes.py` `decide()` | `select_for_update().select_related("requested_by")` joins a nullable column; PostgreSQL answers "FOR UPDATE cannot be applied to the nullable side of an outer join", so approving or rejecting a change would fail with a 500. SQLite ignores the lock, so no test saw it. | `select_for_update(of=("self",))` locks only the request row |
| `backend/analytics/views.py` hourly chart | `EXTRACT(HOUR ...)` can come back as a `Decimal` on PostgreSQL 14+; a list cannot be indexed with it | `hours[int(row["h"])]` |
| `analytics/management/commands/prune_analytics.py` | read a counter, added in Python, wrote it back (lost update if two runs overlap) | `update(weight=F("weight") + total)` |
| `backend/workspaces/views.py` `MyWorkspacesView` | built the whole workspace document (brand, domain, security) per workspace just to read its subscription: about 5 queries per workspace on the busiest endpoint | only `subscription_json` |

Still to watch (not changed, low risk):

| Topic | Note |
|---|---|
| Text length | PostgreSQL enforces `max_length`; SQLite does not. A value longer than its column (a long user agent, a pasted note) is a 500 on PostgreSQL. The test run in section 3 is the check. |
| NUL characters | PostgreSQL refuses `\x00` in text. DRF serializer fields reject it already; any raw `request.data.get(...)` stored directly would not. |
| Case of e-mail addresses | Addresses are stored in lower case by `create_user`, and lookups use `email__iexact`, which becomes `UPPER(email) = UPPER(x)` on PostgreSQL and cannot use the unique index. Fine up to some tens of thousands of accounts. Later: add `Index(Upper("email"), name="user_email_upper")` or look up with `email=` on the lower-cased value. |
| List order | `Lead`, `Card` and some other models order by `created_at` only. Rows created in the same microsecond (a CSV import) can swap places between pages. Add `"-id"` as the second sort key in a later migration. |
| `get_or_create` | Every use is backed by a unique constraint (`user+workspace`, `user+fingerprint`, ...), so a race ends in a retry, not a duplicate. The invoice counter runs inside `transaction.atomic()`. |
| Locks | The cron jobs use `flock` (`deploy/run_job.sh`), which is right for one server. If a second server is ever added, move them to `pg_advisory_lock`. |
| Connections | `conn_max_age=60` keeps a connection per gunicorn worker for a minute; with 4 workers and the background jobs the default `max_connections=100` is plenty. Add `CONN_HEALTH_CHECKS` if the database is restarted often. |
| Money | `price_minor` and `amount_minor` are `PositiveIntegerField` (up to 2,147,483,647 minor units = 21 million in the main currency): enough. |
| Data migrations | All `RunPython` steps have a reverse (a real one or `noop`) and come after the schema changes in their migration. |

## 7. Rollback plan

Before section 5 (the live database is still empty or untouched): nothing to undo; drop the scratch database.

If something fails after the live migration, in order of preference:

1. Code problem, database fine: `sudo -u bench git -C /srv/bench/app checkout PREVIOUS-COMMIT` then restart (README-DEPLOY.md, "If a new version is bad").
2. A migration broke the data: stop the services, then step the app back with
   `sudo -u bench bash -c 'cd /srv/bench/app/backend && set -a && . ./.env && set +a && .venv/bin/python manage.py migrate APP PREVIOUS_MIGRATION_NUMBER'`
   (find the number with `manage.py showmigrations APP`). All data migrations are reversible.
3. The database is damaged: restore the newest dump (`README-DEPLOY.md`, "How to restore a backup"). Take a dump first, always:
   `sudo -u bench bash /srv/bench/app/deploy/backup_db.sh`.
4. PostgreSQL itself cannot be used: nothing falls back to SQLite on the server, and it must not (one file, no concurrent writers).
   Restore the dump to a fresh PostgreSQL, or stay down and tell customers.

Keep this note with the dump file name you took before the run, and write down the time of each step.
