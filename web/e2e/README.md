# Browser tests (Playwright)

End-to-end tests that drive a real Chrome through the real website and API: register, build and publish a card, share it, company
set-up, invitations, field rules and approvals, contacts, webhooks, API keys, data export, account deletion, help and support, and an
accessibility scan (axe-core) of ten key pages in English (left to right) and Arabic (right to left).

Each test creates its own accounts with unique e-mail addresses, so tests do not depend on each other or on earlier runs.
Tests marked `@smoke` are the quick subset (about 10 tests); the rest run in the nightly job.

## What must be running

| Thing | How |
|---|---|
| The API (backend) | with `DEBUG=true`, `CARDS_DEV_ACTIVATE=true` (a "payment" activates the plan at once), `EMAIL_FILE_PATH=<mail folder>` (mails are written to files that the tests read), `WEBHOOK_ALLOW_PRIVATE_TARGETS=true` (the webhook test points at a receiver on 127.0.0.1) and the rate limits raised (`THROTTLE_RATES_JSON`, see `.env.example` here) |
| The website | `next start` of a build, or `next dev`; its `API_URL` and `NEXT_PUBLIC_API_URL` point at that API. For a production build over plain http also set `INSECURE_COOKIES=1` |
| Chrome | locally the installed Chrome (`E2E_CHANNEL=chrome`); on CI `npx playwright install --with-deps chromium` |

The test runs never touch real data, but they DO create accounts: run them only against a throw-away database (the CI does; locally use a
scratch SQLite file), never against the live server.

## Run it

```
cd web
npm ci                                            # installs @playwright/test and @axe-core/playwright
npx playwright install --with-deps chromium       # once, on CI or a fresh Linux machine (not needed with E2E_CHANNEL=chrome)

# the settings (see e2e/.env.example): where the website, the API and the mail folder are
export E2E_WEB_URL=http://localhost:3100
export E2E_API_URL=http://localhost:8100/api/v1
export E2E_MAIL_DIR=/tmp/bench-mail               # the same folder as EMAIL_FILE_PATH of the API
export E2E_CHANNEL=chrome                         # Windows/macOS with Chrome installed; leave empty on CI

npm run e2e:smoke        # the quick subset
npm run e2e              # everything
npm run e2e:a11y         # only the accessibility scan
npm run e2e:list         # list the tests without running them
npm run e2e:report       # open the last HTML report
```

Against `next dev` every page compiles on its first visit, which is slow: add `E2E_EXPECT_TIMEOUT=30000`.

### Local scratch stack (what the developers use)

```
# 1. API on port 9800 with a scratch database
cd backend
export DEBUG=true SECRET_KEY=local-e2e-0123456789abcdef0123456789abcdef DATABASE_URL=sqlite:///e2e.sqlite3
export CARDS_DEV_ACTIVATE=true WEBHOOK_ALLOW_PRIVATE_TARGETS=true ALLOW_LOCAL_THROTTLE_CACHE=true
export EMAIL_FILE_PATH=/tmp/bench-mail CORS_ALLOWED_ORIGINS=http://localhost:4800
export THROTTLE_RATES_JSON='{"auth_login":"100000/min","auth_register":"100000/min","auth_forgot":"100000/min","auth_reset":"100000/min","invite_accept":"100000/min","public_read":"100000/min","public_event":"100000/min","public_lead":"100000/min","slug_check":"100000/min","public_directory":"100000/min","resolve_link":"100000/min","data_download":"100000/min","support_public":"100000/hour","user_read":"100000/min","user_write":"100000/min","user_heavy":"100000/min","user_sensitive":"100000/min","user_create":"100000/hour"}'
python manage.py migrate && python manage.py seed_plans && python manage.py runserver 9800 --noreload
# 2. the website on 4800 (a copy or a build, never the folder with a demo build you want to keep)
API_URL=http://localhost:9800/api/v1 NEXT_PUBLIC_API_URL=http://localhost:9800/api/v1 NEXT_PUBLIC_WEB_URL=http://localhost:4800 npx next dev -p 4800
# 3. the tests
E2E_WEB_URL=http://localhost:4800 E2E_API_URL=http://localhost:9800/api/v1 E2E_MAIL_DIR=/tmp/bench-mail E2E_CHANNEL=chrome E2E_EXPECT_TIMEOUT=30000 npm run e2e:smoke
```

After a git pull run `python manage.py migrate` again on the scratch database; a missing column shows up as a 500 on register.

## Folders

| Path | Content |
|---|---|
| `playwright.config.ts` (in `web/`) | one project, one worker, traces and screenshots only for failures, reports in `e2e/artifacts` |
| `e2e/fixtures/api.ts` | direct API helper: unique e-mails, register, activate a plan (development path), create and publish cards, companies, invites |
| `e2e/fixtures/mail.ts` | reads the mail files (decodes quoted-printable), waits for a mail, finds links in it |
| `e2e/fixtures/company.ts` | add an employee (invite, read the token from the mail, accept) |
| `e2e/fixtures/helpers.ts` | a PNG maker for uploads and the local webhook receiver |
| `e2e/fixtures/global-teardown.ts` | test-data clean-up: asks the API to delete every account the run created (`E2E_KEEP_DATA=1` keeps them) |
| `e2e/tests/*.spec.ts` | the tests, grouped by area |
| `e2e/a11y/baseline.json` | the known accessibility problems; see below |
| `e2e/artifacts/` | reports, screenshots, traces, mails, `a11y-report.json` (git-ignored) |

## How the tests are written

- They check what a person sees (a heading, a message, a count), not how the page is built. Buttons and fields are found by their visible name.
- No fixed waits: every wait is an expectation or a poll (`expect(...).toBeVisible()`, `expect.poll`, `toPass`). The "share your details" form has a
  3-second anti-bot delay on the server; the test retries the send until the delay has passed.
- A test that needs a page that does not exist yet skips itself with a clear reason (`routeExists`).
- Texts are the English ones from `web/src/lib/i18n/en`. If a text changes, change it in the test.
- To investigate a failure: `npx playwright show-trace e2e/artifacts/results/<test folder>/trace.zip`.

## Accessibility baseline

`e2e/tests/accessibility.spec.ts` scans: sign-in, register, privacy, public card, dashboard home, card editor, contacts, help centre, brand,
team, each in LTR and RTL. A finding of impact **serious** or **critical** fails the test unless `e2e/a11y/baseline.json` lists that rule
for that page with at least as many elements. So known problems are tolerated, a new problem or a worse count fails. Fix problems, then
lower the baseline: `A11Y_UPDATE_BASELINE=1 npm run e2e:a11y` rewrites it from the current state (review the change before committing).
The full list of findings with file hints is in `deploy/ACCESSIBILITY_FINDINGS.md`.

## On CI

`.github/workflows/ci.yml` job `e2e` starts PostgreSQL, the API and a built website, installs Chromium and runs `@smoke` on every pull
request; the nightly run (03:00 UTC) and a manual run with "full" run all tests. Reports are kept as an artifact for 14 days.
