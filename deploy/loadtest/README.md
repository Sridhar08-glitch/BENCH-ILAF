# Load test

Answers one question: how many people can use BENCH at the same time on this server before it gets slow or starts to fail?

Files:

| File | What it is |
|---|---|
| `seed.py` | Creates a company with N published cards, contacts, visits and a few sign-in users. Writes `loadtest-seed.json`. `--clean` removes what it made. Runs on the machine that has the database. |
| `locustfile.py` | The load test (Locust). Scenarios, ramp profiles `smoke`, `normal`, `spike`, pass/fail limits. |
| `light_runner.py` | The same idea in plain Python with nothing to install: fine for a 20 to 100 person smoke run. |
| `query_counts.py` | Counts the database queries and the time of each main request (no network, no server needed). Finds "one query per row" problems. |

## What is simulated

| Who | Share | Does |
|---|---|---|
| Visitor | 7 of 10 | opens a card page (website), the card data, the QR image, the contact file, sends a view event, sometimes a directory page |
| Exchanger | 1 of 10 | fills the "share your details" form (a lead) |
| Signed-in owner | 2 of 10 | signs in once, then lists workspaces and cards, opens and edits a card, reads contacts and analytics |

The cards of the visitors are a mix of 20 cards (`--cards 20`), chosen at random.

## Profiles

| Profile | People at once | Length | Use it for | Limits (pass/fail) |
|---|---|---|---|---|
| `smoke` | 20 | 60 s | after every deploy: is it alive and fast | p95 under 1.5 s, under 1% failed |
| `normal` | 200 | 8 min (ramp 1 min) | a normal busy day | p95 under 0.8 s, p99 under 2.5 s, under 0.5% failed |
| `spike` | 1000 | 4 min (100, then up to 1000 in 30 s, back to 100) | an event where everyone scans a code at once | p95 under 2.5 s, p99 under 8 s, under 2% failed |

The numbers are the starting limits; change them with `P95_MS`, `P99_MS`, `MAX_FAIL_PERCENT` when you know your server.

## Before you start (important)

1. **Never point it at the live site with real customers without telling them**, and never run `spike` on it in daytime. Best: run it against
   a staging copy of the server, or run `smoke` only on the live one at night.
2. The API limits each visitor address (`public_read` 240 a minute, `public_lead` 10 a minute and so on). A load test sends everything from ONE
   address, so it would hit those limits and report failures that are not real. For the test only, raise them in the API's `.env`
   (names in `deploy/env.production.example`, key `THROTTLE_RATES_JSON`), for example
   `{"public_read":"1000000/min","public_event":"1000000/min","public_lead":"1000000/min","auth_login":"1000000/min","user_read":"1000000/min","user_write":"1000000/min"}`,
   restart `bench-api`, and **put the old value back afterwards**.
3. Create the data on the server (the seed adds rows with the e-mail domain `loadtest.invalid` only):

```
cd /srv/bench/app/backend
sudo -u bench bash -c 'set -a; . ./.env; set +a; .venv/bin/python ../deploy/loadtest/seed.py --cards 20 --users 5 --out /srv/bench/state/loadtest-seed.json'
```

   Copy `loadtest-seed.json` to the computer that will run the test. When you are done: `seed.py --clean` (same command with `--clean`).
4. Run the test from a computer on a good connection (a laptop on office Wi-Fi is itself a limit at 1000 people; use a rented cloud machine for `spike`).

## Run it

```
pip install locust
cd deploy/loadtest
mkdir -p results

# 20 people for a minute
LOADTEST_PROFILE=smoke  API_URL=https://api.YOURDOMAIN/api/v1 WEB_URL=https://app.YOURDOMAIN SEED_FILE=loadtest-seed.json \
  locust -f locustfile.py --headless --csv results/smoke

# 200 people
LOADTEST_PROFILE=normal API_URL=... WEB_URL=... SEED_FILE=loadtest-seed.json locust -f locustfile.py --headless --csv results/normal

# 1000 people
LOADTEST_PROFILE=spike  API_URL=... WEB_URL=... SEED_FILE=loadtest-seed.json locust -f locustfile.py --headless --csv results/spike
```

Leave `WEB_URL` out to skip the website page views and test only the API. For a window with live graphs, leave out `--headless` and open http://localhost:8089
(the profile still decides the number of people).

Without Locust:

```
python light_runner.py --api https://api.YOURDOMAIN/api/v1 --seed loadtest-seed.json --users 20 --seconds 60
```

The last line says `LOAD TEST PASSED` or `LOAD TEST FAILED: ...` and the exit code is 0 or 1, so a pipeline can use it.

## How to read the result

The table has one row per kind of request:

| Column | Meaning |
|---|---|
| `# reqs`, `# fails` | how many requests, how many broke (an error answer or no answer) |
| Median (p50) | half of the requests were faster than this. What a typical person feels |
| 95% (p95) | 19 in 20 were faster. **The number to watch.** Over 1 second people notice |
| 99% (p99) | the slowest 1 in 100. Shows queues and locks |
| Average, Max | the maximum is usually one unlucky request, do not worry about it alone |
| Current RPS | requests per second the server handled |

Good: failures at 0, p95 steady while the people count stays the same, RPS grows when people grow.
Bad signs: p95 climbs every minute at the same people count (something is filling up: connections, memory, a queue); a wall of `502`/`504`
(the API workers are out; look at `journalctl -u bench-api`); `429` (a rate limit, see step 2 above); `database connection` errors
(PostgreSQL `max_connections`).

While the test runs, in a second window on the server: `top` (CPU of gunicorn and postgres), `free -h`, and
`sudo -u postgres psql -c "select count(*), state from pg_stat_activity group by state"`.

The slowest requests are expected to be: sign-in (about 0.8 s on its own: the password check is slow on purpose), the first view of a card page after a
change (the website renders it again), the analytics call (it adds up a month of visits) and the lead form (it sends e-mail).

## Query counts (how many database calls a request makes)

```
cd backend
DEBUG=true SECRET_KEY=x DATABASE_URL=sqlite:///scratch.sqlite3 ALLOWED_HOSTS=localhost python manage.py migrate
DEBUG=true SECRET_KEY=x DATABASE_URL=sqlite:///scratch.sqlite3 ALLOWED_HOSTS=localhost python manage.py seed_plans
DEBUG=true SECRET_KEY=x DATABASE_URL=sqlite:///scratch.sqlite3 ALLOWED_HOSTS=localhost QC_CARDS=20 python ../deploy/loadtest/query_counts.py
```

Use a scratch database. Run it again with `QC_CARDS=5` and `QC_CARDS=40`: a list whose query count changes with the number of cards has an
"N plus one" problem. Measured on 2026-11-22 with 20 cards (SQLite, no network): public card 5 queries, vCard 4, QR image 1, view event 3, lead 12,
card list 6 (the same for 5 and 20 cards), card detail 11, card edit 16, analytics 18, people analytics 5.
