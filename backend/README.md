# BENCH backend

Django + Django REST Framework API for digital business cards with QR codes, for individuals and
for companies with employees. The API follows `../API_CONTRACT.md` (base path `/api/v1/`, port 8100).

The product name lives in one place: the `PRODUCT_NAME` setting (env `PRODUCT_NAME`, default
"BENCH"), next to `PRODUCT_FULL_NAME` ("Business Enhancement Network Cloud Hub"), `PRODUCT_TAGLINE`
("Your business. One smart identity."), `COMPANY_NAME` ("iLAF Technologies") and `COMPANY_SITE`
(`https://ilaf.qa`). Emails, the admin title, Stripe product names, the statement descriptor suffix
(`ILAF TECH`) and the default vCard note ("Saved from my BENCH card") all read them. The Python
package is still called `ilaf` (an internal module name, not shown to users).

## Setup

```
cd backend
python -m venv .venv
.venv\Scripts\activate            (Linux/macOS: source .venv/bin/activate)
pip install -r requirements.txt
copy .env.example .env            (then edit; a development .env is already present)
python manage.py migrate
python manage.py seed_plans
python manage.py createsuperuser  (for /admin)
python manage.py runserver 8100
```

`seed_plans` creates three placeholder plans (personal, business, company). It never overwrites
prices you edited in the admin; `seed_plans --reset` restores the defaults.

## Environment variables

| Variable | Meaning |
|---|---|
| `SECRET_KEY` | Required unless `DEBUG=true`. |
| `DEBUG` | `true` in development. |
| `ALLOWED_HOSTS` | Comma separated. |
| `DATABASE_URL` | Empty = sqlite file `ilaf.sqlite3`. Postgres: `postgres://user:pass@host:5432/ilaf`. |
| `WEB_BASE_URL` | Web app address (default `http://localhost:3100`). Used in public URLs, invite and reset links, Stripe return URLs. |
| `API_BASE_URL` | Public address of this API, used for image/QR/vCard links. Empty = use the request host. |
| `CORS_ALLOWED_ORIGINS` | Web origins allowed for the signed-in API. Public endpoints allow any origin. |
| `TRUST_PROXY_HEADERS` | `true` behind nginx or a proxy so forwarded addresses are used for throttling and visitor hashes. Forwarded headers are read only when the connecting address is in `TRUSTED_PROXY_IPS`. Leave `false` when exposed directly (headers can be forged). |
| `TRUSTED_PROXY_IPS` | Addresses or CIDR ranges of the proxies in front (default `127.0.0.1,::1`). |
| `NUM_PROXIES` | Extra proxy hops to skip on the right of `X-Forwarded-For` (default 0). |
| `CLIENT_IP_HEADER_SECRET` | Shared secret with the web server: when set, the visitor address in `X-BENCH-Client-IP` must carry `X-BENCH-Client-IP-Signature` (hex HMAC-SHA256 of the address). |
| `TRUST_CLOUDFLARE_HEADER` | `true` only when Cloudflare really is in front: then `CF-Connecting-IP` counts. |
| `THROTTLE_RATES_JSON` | One line of JSON overriding rate limits, for example `{"user_read": "900/min", "auth_login": "30/min"}`. Scopes: see `ILAF_THROTTLE_RATES` in `ilaf/settings.py` (per address: `auth_*`, `public_*`, `slug_check`, `resolve_link`, `data_download`; per signed-in person: `user_read`, `user_write`, `user_heavy`, `user_sensitive`, `user_create`). |
| `REAUTH_WINDOW_SECONDS` | How recent a sign-in must be for linking Google, exports and similar (default 600). |
| `IMAGE_MAX_PIXELS` | Largest accepted picture in pixels (default 40000000). |
| `ANALYTICS_RETENTION_DAYS` | Days of raw visit events kept before `prune_analytics` rolls them up (default 400, minimum 31). |
| `LEADS_CSV_MAX_ROWS` | Most rows in one contacts spreadsheet (default 50000). |
| `JWT_SIGNING_KEY` | Optional separate key for login tokens (default: `SECRET_KEY`). Changing it signs everybody out. |
| `EMAIL_AFTER_RESPONSE` | `true` (default) sends the password-reset mail from a background thread after the answer. |
| `ALLOW_LOCAL_THROTTLE_CACHE` | With `HTTPS_ONLY=true` the app refuses to start without `REDIS_URL`; this acknowledges a single-process setup. |
| `PRODUCT_NAME`, `COMPANY_NAME`, `COMPANY_SHORT_NAME`, `COMPANY_SITE`, `STATEMENT_DESCRIPTOR_SUFFIX` | Brand text. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe Checkout, Billing Portal and webhook signature secret. |
| `STRIPE_RECURRING` | Default `true`: plans are bought as yearly Stripe subscriptions that renew by themselves. `false` falls back to one-time payments (the owner pays again each period) for an account or region that cannot take recurring payments. |
| `CARDS_GRACE_DAYS` | Days a card stays live after the period ends (default 7). |
| `CARDS_DEV_ACTIVATE` | `true` activates a plan at once without Stripe. Also happens when `DEBUG=true` and `STRIPE_SECRET_KEY` is empty. With `HTTPS_ONLY=true` the app refuses to start when this or `DEBUG` is on. |
| `DEFAULT_FROM_EMAIL`, `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `EMAIL_USE_TLS` | SMTP. With no `EMAIL_HOST` emails print to the console. |
| `GOOGLE_CLIENT_ID` | Google OAuth client id for Sign in with Google (public, no secret). Empty = Google sign-in off (503 `google_not_configured`). |
| `GOOGLE_WALLET_ISSUER_ID`, `GOOGLE_WALLET_SERVICE_ACCOUNT_FILE` or `GOOGLE_WALLET_SERVICE_ACCOUNT_JSON`, `GOOGLE_WALLET_CLASS_SUFFIX` | Google Wallet pass (issuer id, service account key as a file path or inline JSON, class name suffix). Empty = 503 `wallet_not_configured`. |
| `EXPORT_ROOT` | Private folder for data export ZIPs (default `private_exports/`). Must not be served to the web. |
| `WEBHOOK_ALLOW_PRIVATE_TARGETS` | Development only: `1` lets webhooks reach http and private addresses (a receiver on this computer). Never in production. |
| `REDIS_URL` | Shared cache so throttle counters are shared between worker processes. Required in production (`HTTPS_ONLY=true`). |
| `AWS_STORAGE_BUCKET_NAME`, `AWS_S3_ENDPOINT_URL`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_REGION_NAME`, `AWS_S3_CUSTOM_DOMAIN` | Optional S3-compatible media storage (Cloudflare R2). Empty bucket = local `media/` folder. |

## Security notes

The audit and what was done about each finding are in `../deploy/PRODUCTION_READINESS.md` (section 9 lists what the web app still has to change). Where the code lives:

- Visitor address and throttles: `ilaf/utils.py` (`client_ip`, `throttle_ident`), `ilaf/throttles.py` (per-address classes and `UserApiThrottle`, whose `_ROUTE_SCOPES` table says which signed-in routes are heavy, sensitive or creating).
- Uploads: `ilaf/images.py` (`decode_safely`: magic bytes, format list, animation, pixel limits). Outbound requests: `ilaf/netsafety.py` (public-address rule), `cards/linktools.py`, `leads/webhooks.py` (one clock per request, watchdog on the socket).
- Sessions: `accounts/services.py` (`tokens_for` stamps `auth_time`, `revoke_refresh_tokens`, `require_recent_auth`, `check_login_password`).
- Company protections: `operations/actions.py` (`check_can_manage_card`), `operations/rules.py` (field rules incl. `slug`, `features`, `vcard`), `leads/views.py` (`lead_access`, the streamed spreadsheet).
- Logs: `ilaf/logfilters.py` masks tokens that travel in URLs.

## Run the tests

```
python manage.py test tests
```

## Smoke test against a live server

```
python manage.py runserver 8100
python scripts/smoke.py http://127.0.0.1:8100
```

It registers a new user, activates the development plan, creates and publishes a card, reads it as
a visitor, downloads the vCard and QR, sends a lead and an event, and checks analytics. Use
`127.0.0.1` rather than `localhost` if something else (for example a mock server) listens on port
8100 on IPv6.

## Scheduled jobs (no Celery)

Run these daily from cron or a systemd timer:

```
python manage.py expire_subscriptions      # marks periods expired once the grace days are over
python manage.py send_renewal_reminders    # emails owners 7 days and 1 day before the end (a plan that renews by itself gets one "renews on" notice), and free-week owners 2 days before the week ends and when it has ended; each once
```

Privacy jobs (see "Privacy, export and deletion"): `process_data_requests` every 5 minutes, `cleanup_data_exports` hourly, `purge_deleted_accounts` daily.

Back office jobs (see "Back office"): `send_announcements` and `expire_support_views` every 5 minutes, `prune_back_office` daily. All are in `deploy/cron/bench-cron`; `deploy/run_job.sh` leaves `ok-<job>`, `fail-<job>` and `last-<job>` (end time, exit code, seconds) in `BENCH_STATE_DIR`, which the staff Jobs tab reads.

Retention: `python manage.py prune_analytics` daily (`--dry-run` shows what it would do). It rolls visit events older than `ANALYTICS_RETENTION_DAYS` into 15-minute summary rows (the `weight` column; all counts and charts stay the same, only unique visitors older than the retention are gone), deletes finished webhook deliveries older than 90 days, reset rows older than a day and the links of invitations that expired a week ago, and never touches audit entries. Every count of events in the code uses `analytics.models.event_count` (sum of weights), never `Count("id")`.

## Deploy with gunicorn

```
pip install -r requirements.txt
python manage.py migrate
python manage.py collectstatic --noinput
python manage.py seed_plans
gunicorn ilaf.wsgi:application --bind 127.0.0.1:8100 --workers 3
```

Put nginx or Caddy in front for HTTPS. Set `DEBUG=false`, a real `SECRET_KEY`, `ALLOWED_HOSTS`,
`DATABASE_URL` (Postgres), `WEB_BASE_URL`, `API_BASE_URL`, `CORS_ALLOWED_ORIGINS`, SMTP settings,
`REDIS_URL` (shared throttle counters) and `TRUST_PROXY_HEADERS=true` when behind Cloudflare.
Static admin files are served by WhiteNoise. Uploaded media must be served by the web server
(point it at `MEDIA_ROOT`) or live in the S3/R2 bucket. In Stripe, add a webhook endpoint at
`https://<api host>/api/v1/stripe/webhook` for `checkout.session.completed` (and optionally
`checkout.session.async_payment_succeeded`), `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated` and
`customer.subscription.deleted`, and put its signing secret in `STRIPE_WEBHOOK_SECRET`. Turn on the Billing Portal in the Stripe
dashboard (cancel at period end and update payment method) so `POST workspaces/{id}/billing-portal` works.

## Behaviour notes

- Roles: owner and admin manage everything; an employee sees and edits only their own card and its leads.
  A user who is not in a workspace gets 404 for it.
- Subscription is `live` while now is no later than `ends_at` plus the grace days. Paying again
  extends from `ends_at` while still inside the grace window, otherwise from now.
- Company workspaces: one card per seat. The owner and every admin hold a seat too.
- Taps in analytics are NFC views plus explicit `tap` events. Scans are QR views.
- Visitor identity is a daily hash of IP, user agent, date and the server secret. No raw IP is stored.
- Link safety: every item value must use one of the schemes in `ilaf/items.py` (`ALLOWED_SCHEMES`), the one
  place to add more. The public payload includes a ready `href` per item.
- `POST tools/resolve-link` fetches pasted links safely (public addresses only, checked again on every
  redirect, 3 s timeout, 1 MB cap) and stores favicons in our own media.

## Card design

Design keys: `face` (25), `bg`, `bg2`, `fg`, `acc`, `on` (hex), `details` (12), `intro` (22 plus `none`), `photo`, `brand_colors`, `foot`. Unknown and old keys (layout, bgm, font, btn, shape, cover, addr, acts) are rejected. The lists live in `ilaf/design.py`.
A company `lock_design` locks face, colours, details and intro for everyone except the owner; the card keeps its own `photo` switch. The cover picture is uploaded with `POST cards/{id}/cover` (JPG/PNG/WebP, 3 MB, stored as 1280x800 JPEG).
Existing rows are converted by data migrations (`cards/0003`, `workspaces/0003`) using `ilaf/legacy.py`; the old JSON is kept in `legacy_design` / `legacy_brand_design` and the migrations are reversible.

## Not built

- Proration and mid-term seat changes under automatic renewal (a Company changes seats through Manage billing or by asking us; Stripe is only ever called with mocks in the tests, nothing was run against a real Stripe account), in-app notifications for Enterprise quotes (they are e-mailed and shown on the Billing page), and Enterprise price lists (by design there is none).
- Custom domains are built (see "Custom domains" below) but only tested with a fake DNS resolver: real DNS, certificates and the edge proxy are not verified (test plan in `deploy/CUSTOM_DOMAINS.md`). One domain per company; no sitemap exists in the project, so none uses the domain.
- Apple Wallet passes (the Google Wallet pass is built, see below).
- Plan downgrade handling for cards already over the new limit, refunds, and tax invoices (invoice numbers are sequential records, not tax documents).

## Company branding
A company workspace keeps its brand colours (`palette`, checked for readable contrast), logo display options and card artwork in `Workspace.brand` (validated in `ilaf/branding.py`). Design colour 4 means "company colours" and needs a palette. Extra pictures are uploaded with `POST workspaces/{id}/symbol|background|template-front|template-back` (`DELETE` removes them), owner and admin only, company workspaces only. The public card payload carries the palette, options and picture URLs in `card.brand`. Details are in `API_CONTRACT.md`, section "Company branding".

## Company operations
App `operations`: `AuditEvent` (append-only), `Department`, `ChangeRequest`. Workspace gains `field_rules`, `directory_enabled`, `directory_slug`; Member gains `department` and `invite_sent_at`; Card gains `hide_from_directory`; Lead gains `workspace` and `card_name` and survives the deletion of its card (migration `leads/0003` fills them for old rows). Modules: `operations/rules.py` (field rules and enforcement), `changes.py` (approval flow and emails), `actions.py` (member and card actions, reassign, offboarding, bulk), `departments.py` (templates), `directory.py`, `audit.py` (`log`, action list). Tests: `tests/test_ops_team.py`, `test_ops_departments.py`, `test_ops_fields.py`, `test_ops_directory.py`. Details in `API_CONTRACT.md`, section "Company operations". Not built: department managers who invite into their own department only.


## Card features

See "Card features" in `API_CONTRACT.md`. Needs `python manage.py migrate` (cards 0006, workspaces 0007, leads 0004). New code: `cards/features.py` (per-card exchange settings, company lead settings), `leads/services.py` (field rules, honeypot, minimum fill time, hourly cap per address and card, consent, e-mail to the card holder and, when asked, company admins), the Meeting item kind in `ilaf/items.py`, `public/views.py` (exchange leads, meeting requests, `qr.png`). Settings: `LEAD_MIN_FILL_SECONDS` (default 3, 0 turns the check off) and `LEAD_MAX_PER_CARD_PER_HOUR` (default 5, 0 turns the cap off). The hourly cap uses the Django cache, so production needs the shared cache (`REDIS_URL`) like the other throttles. `/media/` answers with open CORS so a company logo can be drawn on a canvas.

## Privacy, export and deletion
App `privacy` (`DataRequest` model, `exporter.py`, `services.py`, `views.py`). People export their data (a ZIP of JSON files, their pictures and a README) and delete their account; company owners export and delete the company. Every request is a `DataRequest` row with `kind`, `status`, `requested_at`, `due_at` (30 days), `completed_at` and `handled_by` for the future admin dashboard (already listed in the Django admin).

- Export: built while the request waits when small (`EXPORT_SYNC_MAX_CARDS`, `EXPORT_SYNC_MAX_LEADS`), otherwise left `pending` for `process_data_requests`. There is no Celery, the table is the queue. The e-mailed link is signed (Django `signing`), valid 24 hours and works once; at most 3 exports per person per day. Files are stored in `EXPORT_ROOT` (default `backend/private_exports`, never served as media; on several servers it must be a shared disk) and removed by `cleanup_data_exports`.
- Delete account / company: disabled at once, cards unpublished, 14 days (`DELETION_GRACE_DAYS`) to restore (login page "Restore my account", or the e-mailed link), then `purge_deleted_accounts` erases. People are anonymised rather than removed (the user row stays as `deleted-<id>@deleted.invalid` so audit rows keep their actor id); workspaces are emptied but their row stays so invoices keep their link. A company owner cannot delete the account while the company has other people (delete the company first; ownership transfer is not built).
- Erased by the purge: profile data, Google link, password, photos, card files, cards, seats, leads of personal workspaces and of companies being deleted. Kept: leads of a company (the link to the deleted person's card is cut), audit rows (actor id only), invoices, anonymous analytics of deleted cards are deleted with the cards.

Schedule (cron or systemd timers):

```
python manage.py process_data_requests     # every 5 minutes: builds the big exports and e-mails their links
python manage.py cleanup_data_exports      # hourly: deletes export files that were downloaded or expired
python manage.py purge_deleted_accounts    # daily: erases accounts and companies whose 14 days are over (--dry-run counts only)
```

Tests: `tests/test_privacy.py`.

## Sign in with Google
`accounts/google.py` checks the Google ID token (RS256 signature against Google's published keys, issuer, audience = `GOOGLE_CLIENT_ID`, expiry, verified e-mail). `ilaf/rsa.py` does the RSA maths with the standard library only (verified against OpenSSL signatures), so no extra package is needed; `fetch_jwks` is the only network call and is cached for the time Google allows. Accounts: `accounts/google_views.py` (sign in, link, unlink, set password, restore, invite acceptance), `accounts/services.py` (account creation, domain rule, re-confirmation). Google never links itself to an account whose address was not proven (`User.email_verified`), see the API contract. Company rules `allowed_email_domains` and `require_google_signin` live on `Workspace`. Setup steps for the owner are in `API_CONTRACT.md`, section "Sign in with Google". Tests: `tests/test_google.py` (local RSA test key in `tests/keys.py`, mocked key set).

## Google Wallet pass
App `wallet` (`passes.py`, `views.py`): `GET cards/{id}/wallet/google` returns a `pay.google.com/gp/v/save/<jwt>` link. The JWT embeds the class and the object, so no Wallet API call is made; it is signed with the service account key by `ilaf/rsa.py`. Setup steps and what is and is not updated automatically are in `API_CONTRACT.md`, section "Google Wallet pass". Tests: `tests/test_wallet.py`. Apple Wallet is not built.

## Leads, analytics and reports
Full rules and routes: `API_CONTRACT.md`, section "Leads, analytics and reports". Run `python manage.py migrate` (`leads.0005`, `analytics.0002`).

- **Lead workflow** (`leads/workflow.py`): assignment, status changes and notes each write a timeline line (`LeadActivity`), queue the matching webhook event and, for assignments and status changes in a company, add an audit entry (`operations/audit.py`). The assignee gets an e-mail through `ilaf/emails.py`. Visibility lives in `workflow.visible_leads` (employees: own card plus assigned to them).
- **Webhooks** (`leads/webhooks.py`, `leads/webhook_views.py`): signed (HMAC-SHA256) events in a database queue (`WebhookDelivery`). There is no Celery, so cron sends them:

```
* * * * * cd /path/to/backend && .venv/bin/python manage.py deliver_webhooks     # every minute; safe to overlap
0 7 * * 1 cd /path/to/backend && .venv/bin/python manage.py send_weekly_reports   # Monday morning UTC
```

  Retries back off 1 min, 5 min, 30 min, 2 h, 6 h, 12 h, 24 h; 20 failures in a row switch an endpoint off and e-mail the admins. Targets must be public https addresses (checked after the name lookup and again at every send, no redirects, 5 second timeout, answer capped at 1000 characters). `WEBHOOK_ALLOW_PRIVATE_TARGETS=1` is for development only (receiver on this computer).
- **Connect Zapier or Make**: in Zapier use "Webhooks by Zapier", trigger "Catch Hook"; in Make use "Custom webhook". Paste the address they show into Settings > Integrations > Add webhook, press "Send test event", and the sample contact appears in their editor. These tools do not need the signature. Your own code checks `X-BENCH-Signature` (`sha256=` + HMAC-SHA256 of `<X-BENCH-Timestamp>.<raw body>` with the secret shown once when the webhook was made). No vendor library is used.
- **Analytics** (`analytics/periods.py` date ranges and time zones, `analytics/breakdowns.py` one grouped query per table, `analytics/views.py`): the same functions feed the weekly report. Days are cut in the `tz` the caller sends (UTC without it) because the workspace has no time zone setting. `Event` has an extra index on `(card, created_at)` for range scans.
- **Weekly report** (`analytics/weekly.py`, `analytics/report_views.py`, command `send_weekly_reports`): see the contract. Needs `API_BASE_URL` for the unsubscribe link. `--dry-run` prints what would go out. Tests: `tests/test_lead_workflow.py`, `tests/test_webhooks.py`, `tests/test_analytics_breakdowns.py`, `tests/test_weekly_reports.py`.

## Public API and API keys
- Owners and admins make keys in Settings > Developers (`publicapi/manage_views.py`, routes `workspaces/<id>/api-keys`, `.../revoke`, `.../rotate`). The secret (`bnch_live_...`, prefix from `API_KEY_PREFIX`) is shown once; the database holds only its SHA-256 hash and the first 8 characters. A key has scopes (`cards:read`, `cards:write`, `leads:read`, `leads:write`, `team:read`, `team:write`, `analytics:read`; a write scope does not include the read scope), an optional expiry, an optional IP allow-list and its own limits (default 120 per minute and 5000 per day, answered with `X-RateLimit-*` headers and 429 + `Retry-After`).
- The API is under `/api/public/v1/` (`publicapi/views.py`), authenticated only with `Authorization: Bearer <key>` (`publicapi/auth.py`); it never accepts a sign-in token and the signed-in API never accepts a key. Every query starts from the key's own company; another company's rows answer 404. Lists use cursor pagination (`limit`, `cursor`), reads send an `ETag` and honour `If-None-Match`, `POST` honours `Idempotency-Key` for 24 hours (only successes are remembered), errors have one shape `{"error": {"code", "message", "fields"?, "request_id"}}`. The key acts as an administrator of its company but never on the owner or an admin; cards held by employees follow the company field rules (a field that would need approval is refused with `approval_required`) and a locked company design wins.
- Every write is written to the company activity log with the key as the actor (name and visible prefix, never the secret). The OpenAPI 3.1 document is generated by `publicapi/spec.py` at `/api/public/v1/openapi.json`; `tests/test_public_api_spec.py` fails if a route or scope drifts from it. The developer guide is the public page `/developers` of the web app.
- Cron: `prune_api_idempotency` daily. Log lines never hold a key (`ilaf/logfilters.py` masks `<name>_live_...` strings and bearer tokens).
- Messages: the public API keeps English-only machine messages (documented). The messages and e-mails of the settings pages are bilingual: Arabic texts are in `ilaf/locale_ar_integrations.py`, and the web shows CRM problems by error code through its own message files.
- Tests: `tests/test_public_api.py`, `tests/test_public_api_spec.py`, `tests/test_integrations_i18n.py`.

## CRM connectors (HubSpot, Salesforce, Zoho CRM)
Settings > Integrations > CRM lets an owner or admin connect a company to a CRM with OAuth 2.0 (authorization-code flow). Code: `crm/` (`vendors.py` per vendor, `sync.py` queue and retries, `views.py` settings routes, `crypto.py` token encryption, `http.py` outbound calls).
- A new lead (every lead event passes `leads.webhooks.enqueue`) adds one job per connected CRM. The command `python manage.py sync_crm` (cron every minute through `deploy/run_job.sh`, which holds a lock) sends the jobs: it refreshes an expired token, finds the contact by e-mail (so nobody is created twice), updates it or creates it, adds one note (a Task in Salesforce) per lead, optionally sets the owner by e-mail match (the card holder, or the assignee) and, when switched on, the status. Failures: rate limits wait for the vendor's `Retry-After`; temporary errors retry with growing gaps up to 8 times; refused data fails at once with the vendor's reason; a vendor that refuses our access (revoked, dead refresh token, unreadable token) switches the connection off and e-mails the company admins, and the waiting jobs resume after the owner connects again. Health per connection (`ok`, `retrying`, `failing`, `needs_reconnect`), last error code and last success are shown in the page. Backfill queues the last 30 days (at most 500 leads) that the CRM has not received. "Send test lead" sends a made-up lead at once (the sample contact `sample.visitor@example.com` stays in the CRM; delete it there).
- Tokens are stored encrypted (`crm/crypto.py`: Fernet when the `cryptography` package is installed, otherwise an HMAC-SHA256 counter-mode cipher with an encrypt-then-MAC tag from the standard library; the stdlib format is readable by every server). The key is derived from `CRM_ENCRYPTION_KEY` (required in production when any CRM is enabled; changing it disconnects every CRM). Tokens are never logged, never returned by the API and never shown in the page.
- Outbound calls go only to the vendor's own hosts over https (HubSpot `api.hubapi.com`; Salesforce the login host from `SALESFORCE_LOGIN_URL` and the org's own `*.salesforce.com`/`*.force.com` address from the token answer; Zoho `accounts.zoho.<region>` and `www.zohoapis.<region>` for the regions in `ZOHO_REGIONS`). Every address must resolve to a public IP, the connection is pinned to the checked address and redirects are not followed (`crm/http.py`).
- Field mapping: per company and CRM, lead fields (`first_name`, `last_name`, `email`, `phone`, `company`, `message`, `source`, `card_name`) to CRM field names, with defaults (HubSpot `firstname`, `lastname`, `email`, `phone`, `company`; Salesforce Lead `FirstName`, `LastName`, `Email`, `Phone`, `Company`, `Description`; Zoho Leads `First_Name`, `Last_Name`, `Email`, `Phone`, `Company`, `Description`). An empty value skips a field. The status mapping (new, contacted, qualified, won, lost) has defaults per CRM and is editable because each Salesforce or Zoho account has its own picklist values.
- Not verified against real vendors. No vendor account was available: every call follows the vendor's published API reference and is tested against fakes (`tests/test_crm.py`). Before the first customer, connect a test HubSpot portal, a Salesforce developer org and a Zoho trial and check: the scopes (below), HubSpot note creation, the Salesforce Task used as a note, the Zoho `Leads/upsert` duplicate check, owner lookup and the default status values.

### Owner steps: create the OAuth app for each vendor
Use the redirect address exactly as shown (it uses the API host of this server): `https://<API host>/api/v1/crm/callback/hubspot`, `.../salesforce`, `.../zoho`. The Integrations page shows the exact address to copy. Then set the values in the server environment (`backend/.env`) and restart the API: the Connect button appears.
1. HubSpot (developers.hubspot.com, a developer account, Apps > Create app, Auth tab): redirect URL as above; scopes `crm.objects.contacts.read`, `crm.objects.contacts.write`, `crm.objects.owners.read` (and `oauth`). Copy the Client ID and Client secret into `HUBSPOT_CLIENT_ID` and `HUBSPOT_CLIENT_SECRET`.
2. Salesforce (Setup > App Manager > New Connected App): enable OAuth Settings, callback URL as above, selected scopes "Manage user data via APIs (api)" and "Perform requests at any time (refresh_token, offline_access)", tick "Require Secret for Web Server Flow", leave PKCE off. Copy the Consumer Key and Consumer Secret into `SALESFORCE_CLIENT_ID` and `SALESFORCE_CLIENT_SECRET`. `SALESFORCE_LOGIN_URL` stays `https://login.salesforce.com` (use `https://test.salesforce.com` for sandboxes). A new connected app can take a few minutes to start working.
3. Zoho CRM (api-console.zoho.com, "Server-based Applications"): authorized redirect URI as above; copy Client ID and Client Secret into `ZOHO_CLIENT_ID` and `ZOHO_CLIENT_SECRET`. The app asks for `ZohoCRM.modules.leads.ALL`, `ZohoCRM.modules.notes.CREATE`, `ZohoCRM.users.READ`. Zoho keeps each customer's data in one region (data centre): tick "Use the same OAuth credentials for all data centers" (Multi-DC) when creating the client so one id and secret serve every region; the customer picks the region when connecting and `ZOHO_REGIONS=com,eu,in` lists the choices (Qatar and the Gulf use `com` or `eu`). This multi-region behaviour is one of the things to check on a real trial account.
- Deploy: `manage.py migrate` (apps `publicapi`, `crm`), set `CRM_ENCRYPTION_KEY`, install the new cron lines (`sync_crm`, `prune_api_idempotency`).

## Languages (English and Arabic)
English is the source language. `ilaf/i18n.py` holds the language codes (`SUPPORTED_LANGUAGES`, `RTL_LANGUAGES`), the language of a request or a person (`request_language`, `member_language`, `language_for_email`), the plural rules (`plural_category`, `trn`), date names (`format_date`) and the translator `tr(lang, "English text with {placeholders}", ...)`. Texts are looked up by their exact English wording in a catalogue per language (`ilaf/locale_ar.py`); a text without a translation is sent in English. Python's gettext is not used because the machine tools for compiling `.po` files (`msgfmt`) are not part of this deployment; the catalogue is a plain module, covered by tests (placeholder parity, plural forms, month names).
- Where the language comes from: users have `language` (`en`, `ar`, empty = not chosen); invited people carry the invite's `language`, which becomes the account language when they accept; API errors follow `X-Language`, then the user, then `Accept-Language`.
- E-mails (`ilaf/emails.py`): every builder takes `lang`; Arabic mail is `lang="ar" dir="rtl"`, right-aligned, with an Arabic-capable font stack, Latin names isolated with Unicode isolates, dates with Arabic month names and the six Arabic plural forms. The weekly reports, invites, resets, approvals, lead and assignment notices, webhook-off notices and the data export and delete mails are translated; the plan renewal reminders, the payment-failed mail, the Enterprise quote mail and the free-week mails (billing) are translated too.
- Adding a language later is more than a message file: the web app builds one complete catalogue per language (`web/src/lib/i18n`: add the code to `LOCALES`, `LOCALE_NAMES` and `RTL_LOCALES` in `config.ts`, one file per area in `<code>/`, and register it in `messages.ts`; `i18n.test.ts` fails until the keys match English exactly), and the backend needs the steps in the next point. Only English and Arabic exist today.
- **Error messages and the registry.** `ilaf/error_codes.py` lists every error code (`ERROR_CODES`: English default, status, params) and every literal sentence the API can answer (`ERROR_MESSAGES`, including the field messages of Django REST framework and the password checks). It is generated, never edited: run `python scripts/extract_error_codes.py` after adding or changing an error (`--check` only tests). Arabic for a sentence goes in `ilaf/locale_ar_errors.py` (`TEXTS` exact wording, `PATTERNS` with a value, a pattern template may be a function). A sentence that travels inside a successful answer (a bulk `reason`, an import's skipped rows) must go through `localise_message(request, text)`. Rules for a new message: write it in plain English, raise it through `ApiError(code, message, status)` (or `validation_error`), give the code an `apiError.<code>` text in `web/src/lib/i18n/en` and `ar`, never show or build a sentence in the web app from the server's text. `tests/test_error_codes.py` fails when the registry is out of date, a sentence lacks Arabic, a code lacks its web texts, a sentence given to `tr`/`trn` has no Arabic, an e-mail sender is not told the language, or an e-mail subject, heading, button or paragraph is a bare literal.
- Add a language: add the code to `SUPPORTED_LANGUAGES` (and `RTL_LANGUAGES` if it is written right to left), create `ilaf/locale_<code>.py` with `TEXTS`, `PLURALS`, `MONTHS`, `PATTERNS` like `locale_ar.py`, register it in `ilaf.i18n._catalogues`, allow the code in the model choices of the language fields if you add any, and run `manage.py test tests.test_i18n`.
- Run `manage.py migrate` after updating: `accounts 0003`, `cards 0007` and `workspaces 0009` add the `language` fields.
- vCards carry `;CHARSET=UTF-8` on text that is outside the Latin alphabet and never transliterate names.


## Staff area and custom designs

Apps `staff` (roles, two-step verification, staff audit log, company list) and `designs` (requests, files, custom faces, sanitiser, previews). See "Staff area and custom designs" in `API_CONTRACT.md` for the role matrix, endpoints and the template language.

- Name the first staff admin: `python manage.py grant_staff person@company.com admin` (the account must exist).
- `PRIVATE_FILES_ROOT` (default `backend/private_files`; keep it outside the web root and back it up): request files live here and are served only by authenticated endpoints. `STAFF_NOTIFY_EMAILS` (comma list) adds addresses told about new requests; support and admin staff are always told.
- Migrations: `accounts.0004_user_staff_role`, `staff.0001`, `designs.0001`.
- Sanitiser tests: `tests/test_sanitize.py` (over 120 hostile inputs, property tests). After changing the sanitiser run `WRITE_SANITIZE_CORPUS=1 python manage.py test tests.test_sanitize`, copy `tests/sanitize_corpus.json` to `web/src/lib/library/custom/sanitize-corpus.json` and run the web tests.
- Every new message has an Arabic text in `ilaf/locale_ar_designs.py`; `tests/test_design_i18n.py` fails when one is missing.

## Back office (the staff dashboard)

App `staff` (continued). Endpoints, roles and tables are in "Back office" of `API_CONTRACT.md`. The code is split by screen: `views_overview`, `views_customers` (companies, search, cards, people), `views_supportview`, `views_safety` (card reports, data requests), `views_growth` (applications, announcements, analytics), `views_system` (health, e-mail, jobs, errors, switches, billing placeholder), `views_staffadmin`, `public_views` (what visitors and customers reach), plus `perms_map.py` (the one role table), `metrics.py`, `errorlog.py`, `flags.py`, `announce.py`, `ops_services.py`.

- Roles: take them from `perms_map.roles_for("<permission>")` in a view's `write_roles` and set `perm = "<permission>"` to close even reading to the roles that lack it. The permissions page of the web reads the same table.
- Audit: call `services.log(...)` in every write. A write that forgets is stored as `staff.unlabelled_write`; `BackOfficeCase.tearDown` fails on it and `AuditCoverageTests` checks the source.
- Support view is read only on purpose: the mirror views have only `get`, never call a customer view, and every start, page and end is logged to the staff audit log and to the company's own Activity log.
- Feature switches: ask `staff.flags.flag_enabled("<key>", workspace)` or call `require_flag`; a new switch is one line in `flags.KNOWN` (a switch with no row is on, so adding one hides nothing).
- E-mail: send through `ilaf.emails.send_brand_email(..., kind="transactional"|"marketing")` so the e-mail log sees it. Announcement e-mails check `User.product_updates` for marketing.
- Settings (all optional): `BENCH_STATE_DIR` (default `/srv/bench/state`), `ABUSE_SLA_HOURS` (48), `SUPPORT_VIEW_MINUTES` (30), throttle scopes `public_report` and `public_company_lead` (5/hour each), `STAFF_NOTIFY_EMAILS` (also told about new applications).
- Migrations: `accounts.0005`, `cards.0009`, `workspaces.0010`, `staff.0002` (all named `back_office`).
- Tests: `tests/test_back_office.py` (role edges of every endpoint, suspensions, support view, audit), `test_back_office_safety.py`, `test_back_office_growth.py`, `test_back_office_system.py`. Every message a customer or visitor can see has its Arabic text in `ilaf/locale_ar_admin.py`.

## Support (tickets, e-mail replies, live chat)

App `support`: `models.py` (ticket, message, attachment, chat session and message, staff presence, settings row, canned replies, bans), `services.py` (numbers, context cleaning, attachments, SLA, e-mails), `hours.py` (business-hours arithmetic), `chat.py`, `mailparse.py` (inbound mail), `views.py` (customer, public, chat), `staff_views.py` (inbox, chat console, metrics, settings). See "Support" in `API_CONTRACT.md` and "Support mailbox" in `deploy/README-DEPLOY.md`.

- Settings: `SUPPORT_REPLY_TO`, `SUPPORT_IMAP_HOST/PORT/USER/PASSWORD/FOLDER`, `SUPPORT_INBOUND_SECRET`, `SUPPORT_ALERT_EMAILS`, `SUPPORT_TICKET_PREFIX`, `SUPPORT_MAIL_MAX_BYTES`. Optional: `SUPPORT_VIRUS_SCAN` (dotted path of `(data, content_type) -> "clean"|"infected"|"pending"`; the placeholder accepts every file that passed the type check), `SUPPORT_POW_DIFFICULTY`, `SUPPORT_MIN_FILL_SECONDS` (public form).
- Jobs: `fetch_support_mail` and `support_tick`, both every minute through `run_job.sh` (see `deploy/cron/bench-cron`); `check_bench.sh` watches them. Chat conversion also runs lazily on chat requests, so a stopped cron never leaves a visitor waiting.
- The chat switches are enforced here, not only in the screen: `support.chat.chat_allowed(workspace)` is true only when the support setting `chat_enabled` is on AND the `support_chat` feature switch is on for the caller's company (a caller without a company is only refused when the switch is off for everybody). `chat.availability()` and `chat.start()` use it: a new chat that cannot be answered live becomes a ticket at once (`offline_converted`, `converted_to_ticket`, `reason`); a chat that is already `active` may finish; a `waiting` chat becomes a ticket on the next sweep. `GET support/chat/status?workspace=` returns the same answer (`live`, `reason`) the start will act on. Tests: `tests/test_chat_switch.py`.
- Company country: `Workspace.country` (ISO 3166-1 alpha-2, null until chosen) validated against `ilaf/countries.py` (English and Arabic names; the web list `web/src/lib/countries.ts` has the same codes and a test compares the two files). The staff company screens show it; staff analytics counts companies per country by their own country first and by the visitor guess (marked guessed) otherwise.
- Chat transport is short polling with `since` cursors and ETags (the deployment is gunicorn workers: no long-lived connections). Typing and read marks are plain columns on the session.
- Files are private (`PRIVATE_FILES_ROOT`), named at random, type-checked by their first bytes, at most 5 per message and 10 MB each, and served only through authenticated download endpoints.
- No message text, e-mail address or visitor address is logged; visitor addresses are stored only as a salted hash (used for bans and the open-chat limit).
- Migration: `support.0001_initial`. Tests: `tests/test_support_tickets.py`, `test_support_mail.py`, `test_support_chat.py` (every customer-facing text must have an Arabic text in `ilaf/locale_ar_support.py`; a test checks it).

## Launch features (search setting and event leads)
Run `python manage.py migrate` (`cards.0008` adds `Card.seo_indexable`, default false; `leads.0006` adds `Lead.tag`, `Lead.event_name` and `Lead.client_ref`). `seo_indexable` is written through the normal card update (`cards/services.py`) and read by the web app from the public payload to choose index or noindex for the card page. `POST workspaces/<id>/leads` (`leads/views.py`, `MANUAL_SOURCES`, `EVENT_TAGS`) accepts `source` `scanned_card` (default) or `event`, an optional `tag`, `event_name` and `client_ref`; an event lead may have no name when something else says who it is, and the same `client_ref` from a member who can see that lead returns the existing lead (200) so an offline phone can retry safely. Arabic texts of the new messages are in `ilaf/locale_ar_growth.py`. Tests: `tests/test_growth.py`. The server spreadsheet (`leads.csv`) is unchanged and does not carry `tag` or `event_name` yet; the web app's own event export does.

## Billing: Enterprise by request and automatic renewal
App `billing`. Plans: `free` (7-day trial), `personal`, `company`, `enterprise` (price 0 = by quote, no list price) and the retired `business`. `billing/services.py` holds the rules: `plan_is_paid(plan)` (the one answer to "does this plan cost money", never test `price_minor` directly), `is_live`, `grace_for`, `activate` (idempotent on Stripe session id and invoice id), `enterprise_allowed(workspace)` / `require_enterprise(workspace)` (the Enterprise-only features: departments, directory, field rules and approvals, activity log, integrations, custom domain, sign-in rules; also true for a Company period that began before 2026-11-25 and was not paid for again since). `enterprise.py` is the quote flow (`EnterpriseRequest`: owner asks, staff quote seats and price per seat in the back office, the owner accepts and pays), `checkout.py` the Stripe Checkout (subscription mode, yearly `price_data`) and Billing Portal calls, `webhooks.py` one handler per Stripe event, `notices.py` the e-mails (English and Arabic). Migrations `0003` (renewal fields, `EnterpriseRequest`, `Payment.stripe_invoice_id`) and `0004` (adds the `enterprise` plan to an existing database; `seed_plans` does the same for a new one). Tests: `tests/test_enterprise.py` (the central paid rule, gating, grandfathering, the quote flow, the staff screens) and `tests/test_renewal.py` (every webhook event with hand-built Stripe objects, the portal, checkout payloads, failed payments and their grace days, seat floors, reminders and the free-week mails). `tests/base.py`: `company(owner, plan="enterprise")` is the default for a company (most company tests use Enterprise-only features); pass `plan="company"` for the plain Company plan, `enterprise(ws, seats)` to put a company on Enterprise and `age_company_plan(ws)` to make its period look as if it was bought before the cut-off. Details and the table of what each plan may do are in `API_CONTRACT.md`, last section.

## Custom domains (Enterprise)
Module `workspaces/domains.py` (rules), `workspaces/views_domains.py` (routes), model `CustomDomain` (migrations `workspaces/0012` to `0014`; the old free-text `Workspace.custom_domain` column is gone and its values became *pending* claims). A claim is pending until a TXT record (`_bench-verify.<domain>` = `bench-verify=<token>`) and a CNAME to `CARD_DOMAIN_CNAME_TARGET` (or an apex A record from `CARD_DOMAIN_A_RECORDS`) are found; the name is unique only among verified rows, so the first company to verify wins. DNS goes through a resolver object (`domains.DnsResolver`, real one on `dnspython==2.7.0`, `domains.set_resolver(fake)` in tests). `manage.py check_custom_domains` (hourly cron) retries pending claims for 7 days, re-verifies verified ones, marks `dns_broken` after 3 days of missing records (e-mail to the owners, English and Arabic) and releases the name after 14 more days; `manage.py list_custom_domains` prints the domains served now (used by `deploy/custom-domains/issue_certs.sh`). Public lookups: `GET domains/resolve?host=` (the Next middleware) and `GET domains/allowed?domain=` (Caddy's on-demand TLS ask, `DOMAIN_ASK_TOKEN`). `cards.services.public_url(card)` is the single place a card address is built and uses the domain once it is active (verified and Enterprise-live); the public card and directory endpoints take `?host=` and refuse another company's card. Settings: `CARD_DOMAIN_*`, `DOMAIN_ASK_TOKEN` (see `deploy/env.production.example`). Tests: `tests/test_custom_domains.py` (names, claims, every DNS state with a fake resolver, squatting, cron, resolve/allowed, addresses, isolation between companies, privacy export/erasure, the data migration). Everything else (DNS instructions for customers, Caddy and nginx, security model, staging test plan) is in `deploy/CUSTOM_DOMAINS.md`; the API in `API_CONTRACT.md`, section "Custom domains (Enterprise)".

- **Employee sharing switch** (`workspaces/sharing.py`, `Member.share_contacts`, `Lead|Order|Booking.shared_with_company`): off by default, set by the employee only (`workspaces/{id}/me`). `card_shares_with_company(card)` is the one place the snapshot is decided when a contact, order or booking is created; `leads.models.is_company_owned` / `company_owned_leads`, `leads.workflow.visible_leads` / `can_see`, `workspaces.access.commerce_orders` / `commerce_bookings`, `leads.services.card_recipients(card, lead)` and `analytics.breakdowns.lead_scope` read the snapshot, so webhooks, CRM, the developer API, exports, reports and analytics all follow it. Turning it off never un-shares what was shared. Tests: `tests/test_share_contacts.py`.
