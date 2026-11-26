# Custom domains (Enterprise)

A company on the Enterprise plan can show its cards on its own web address: `https://cards.northgate.com/ahmed` instead of
`https://app.bench.example/c/ahmed`. This file explains how it works, what the customer does in DNS, what the server needs
(certificates, proxy, firewall), how to test it on a staging domain, how to find problems, and the security model.

**Status:** the application code (database, API, DNS checks, cron, web routing, screens) is built and covered by tests with a fake DNS
resolver. Nothing in this file was run against real DNS, a real certificate authority or a real proxy: the manual test plan at the end
is how you prove it on a staging domain before a customer relies on it.

## 1. How it works

```
 visitor                      edge (Caddy or nginx)                Next.js web app              Django API
 https://cards.northgate.com  TLS for that name only if the   -->  src/middleware.ts      -->    GET /api/v1/domains/resolve?host=...
 /ahmed                       API says it is a live domain        rewrites /ahmed to /c/ahmed    (verified? Enterprise-live? which company?)
                              (GET /api/v1/domains/allowed)       and renders that company's     GET /api/v1/public/cards/ahmed?host=cards.northgate.com
                                                                  card (the API refuses a card
                                                                  of any other company)
```

1. **Claim.** On *Brand > Company and domain* the owner or an admin enters `cards.northgate.com`. Bench stores it as a *pending* claim with a
   random token. A pending claim serves nothing and blocks nobody: any number of companies can have a pending claim on the same name.
2. **Prove.** The owner adds two DNS records (the screen shows them with copy buttons):
   * `TXT  _bench-verify.cards.northgate.com  =  bench-verify=<token>`: proves the owner controls the domain's DNS;
   * `CNAME  cards.northgate.com  ->  <CARD_DOMAIN_CNAME_TARGET>`: sends visitors to Bench (a bare domain uses A records, see 3).
3. **Check.** *Check now* (and the hourly cron `check_custom_domains`) asks DNS. When both records are right the claim becomes *verified*.
   The **first company to verify wins**: from then on nobody else can verify or claim that name.
4. **Serve.** While the claim is verified **and** the company is Enterprise-live, the domain serves that company's cards: `/<slug or code>`
   shows a card of that company (a card of another company is "not found" there), `/` shows the company directory when it is on, else the
   company card if there is one, else a neutral 404. QR codes, share links, wallet passes, vCard links, Open Graph tags and canonical links
   of those cards use the domain. The Bench address keeps working.
5. **Stop.** If the plan lapses, requests to the domain are redirected (302) to the same card on the Bench address; if the claim is removed
   the host is unknown and gets a plain 404. The certificate is simply never renewed for a name the API no longer allows.

Statuses of a claim (`workspaces.models.CustomDomain.status`):

| Status | Meaning | Serves? |
|---|---|---|
| `pending` | claimed, not checked yet | no |
| `failed` | last check failed (`last_error` says why); still retried every hour | no |
| `expired` | 7 days (`CARD_DOMAIN_PENDING_DAYS`) without success; "Check now" starts a new window | no |
| `verified` | DNS proven | yes (if Enterprise-live) |
| `dns_broken` | the records were missing for 3 days (`CARD_DOMAIN_BROKEN_DAYS`); the owner got an e-mail | yes, for 14 more days (`CARD_DOMAIN_GRACE_DAYS`), then released (`failed`, `dns_released`) |

Failure reasons: `txt_missing`, `txt_mismatch`, `cname_missing`, `cname_wrong`, `dns_error` (DNS itself did not answer: never counted as
"records missing"), `domain_taken`, `dns_released`.

One domain per company for now (`CustomDomain.workspace` is one-to-one). Adding another domain replaces the first.

## 2. Settings (backend `.env`, web `.env.production`)

| Setting | Default | Meaning |
|---|---|---|
| `CARD_DOMAIN_CNAME_TARGET` | host of `WEB_BASE_URL` | the name customers point their CNAME at. Must resolve to the edge server (Caddy or nginx below) |
| `CARD_DOMAIN_A_RECORDS` | empty | fixed IPv4/IPv6 addresses of the edge server, offered to customers who must use a bare domain (`northgate.com`) where a CNAME is not allowed. Empty = bare domains are not offered A records (the screen tells the customer to use a subdomain) |
| `CARD_DOMAIN_RESERVED_HOSTS` | empty | extra names customers can never claim (the web host, API host and CNAME target are always refused, and their parents) |
| `CARD_DOMAIN_PENDING_DAYS` | 7 | how long a pending/failed claim is retried |
| `CARD_DOMAIN_BROKEN_DAYS` / `CARD_DOMAIN_GRACE_DAYS` | 3 / 14 | records missing this long -> `dns_broken` + e-mail; still served this much longer |
| `CARD_DOMAIN_RECHECK_HOURS` | 20 | a verified domain is re-verified about once a day |
| `CARD_DOMAIN_DNS_TIMEOUT` / `CARD_DOMAIN_DNS_SERVERS` | 4 / system | seconds per DNS question; optional resolver IPs (for example `1.1.1.1,8.8.8.8`) when the server's own resolver is slow or filtered |
| `DOMAIN_ASK_TOKEN` | empty | secret for `GET /api/v1/domains/allowed` (Caddy's on-demand TLS "ask"). Set it in production. Empty = only a caller on this machine that sends no proxy header |
| `WEB_EXTRA_HOSTS` (web) | empty | extra host names that are the Bench site itself (for example a `www.` of a different domain); everything else is treated as a possible customer domain |

`ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS` and `CSRF_TRUSTED_ORIGINS` do **not** list customer domains (see the security model).

`dnspython==2.7.0` is a new backend requirement (`pip install -r backend/requirements.txt`, `deploy.sh` does it).

## 3. What the customer does in DNS

They need to sign in where their domain's DNS is managed (the registrar, Cloudflare, GoDaddy, Namecheap, or their IT team) and add the two
records the Brand page shows. **Use a subdomain** (`cards.northgate.com`): it works everywhere.

| Provider | Where | Notes |
|---|---|---|
| **Cloudflare** | DNS > Records > Add record | Add the TXT (Name `_bench-verify.cards`, Content the value). For the CNAME set **Proxy status = DNS only (grey cloud)**: with the orange cloud Cloudflare answers with its own addresses, Bench cannot see the CNAME and cannot issue a certificate for the name. Cloudflare also flattens a CNAME on the bare domain, which is why the check can be confused there |
| **GoDaddy** | My Products > DNS > Add | Type TXT, Name `_bench-verify.cards`, Value the token text, TTL 1 hour. Type CNAME, Name `cards`, Value the target. GoDaddy wants only the part before the main domain in *Name* |
| **Namecheap** | Domain List > Manage > Advanced DNS > Add New Record | TXT Record, Host `_bench-verify.cards`; CNAME Record, Host `cards`. *Host* is the part before the main domain; leave out the trailing dot |
| other / IT team | send them the table from the Brand page | |

Many providers want only the part before the main domain in the name field (`_bench-verify.cards` for `_bench-verify.cards.northgate.com`);
others want the full name. If *Check now* says "TXT not found", try the other form.

**Bare domains (`northgate.com`, `northgate.co.uk`).** DNS does not allow a CNAME on the zone's apex (it would conflict with the SOA/NS/MX records).
If the operator sets `CARD_DOMAIN_A_RECORDS` the screen shows those A records instead of the CNAME for a bare domain; a few providers
(Cloudflare, DNSimple, Route 53 alias) offer "CNAME flattening" / ALIAS, which also works if it ends at the CNAME target. Otherwise recommend the
subdomain. Verification accepts either (a CNAME chain that ends at the target, or an A/AAAA record equal to one of `CARD_DOMAIN_A_RECORDS`).

## 4. Certificates and the edge server

Customer names need their own certificates. Two ways; **pick one per public IP address**.

### 4a. Caddy (recommended): `deploy/caddy/Caddyfile`
Caddy gets and renews a certificate for each name on its first visit ("on-demand TLS") but only after asking the API
(`GET http://127.0.0.1:8101/api/v1/domains/allowed?token=...&domain=<name>`). The API answers `200` only for a verified domain of an
Enterprise-live company, `404` for anything else; this is what protects you from someone pointing thousands of names at the server to burn
Let's Encrypt limits.

* Caddy must own ports **80 and 443** on the address customers point at. The shared BENCH server already runs nginx on 80/443 (and another app);
  **do not start Caddy there**. Use a small separate edge server (any 1 GB VM) whose public IP is `CARD_DOMAIN_A_RECORDS` / the CNAME target, and
  let Caddy reverse-proxy to the web app over a private network or WireGuard (change `127.0.0.1:3101` and the ask URL in the Caddyfile to the
  private address; the API's `/domains/allowed` is then reached over that link, so keep `DOMAIN_ASK_TOKEN` set).
* Install Caddy (Debian/Ubuntu: the official `caddy` package), then:
  `sudo cp deploy/caddy/Caddyfile /etc/caddy/Caddyfile`, replace `__ASK_TOKEN__`, `__ACME_EMAIL__`, `__API_HOST__`, `__WEB_HOST__`,
  `sudo caddy validate --config /etc/caddy/Caddyfile`, `sudo systemctl reload caddy`.
* systemd: the package installs `caddy.service` (user `caddy`, state in `/var/lib/caddy`, binds 80/443 with `CAP_NET_BIND_SERVICE`). Nothing else to add.
  `systemctl status caddy`, `journalctl -u caddy -f` (the ask result of every new name is logged).
* The ask URL must be exempt from the HTTPS redirect: `SECURE_REDIRECT_EXEMPT` already lists it (plain http to gunicorn on 127.0.0.1).

### 4b. nginx + certbot: `deploy/nginx/bench-customdomains.conf` + `deploy/custom-domains/issue_certs.sh`
For the case where nginx already owns 80/443 (the shared server). A catch-all server block (regex `server_name`, so names owned by other server
blocks keep winning) serves each name with `/etc/letsencrypt/live/<name>/`. The script `issue_certs.sh` runs from cron every 10 minutes:
it reads the live domains from `manage.py list_custom_domains`, runs `certbot certonly --webroot` for each one without a certificate
(at most 5 new per run, 6 hours back-off after a failure), deletes certificates of domains no longer served, and reloads nginx.
A new customer therefore waits up to 10 minutes after verification for HTTPS (Caddy: seconds, on the first visit).

Install: copy `bench-customdomains.conf` to `sites-available`, `bench-web-proxy-custom.conf` to `/etc/nginx/snippets/`, replace `__WEB_HOST__`
and `__API_HOST__`, `sudo nginx -t && sudo systemctl reload nginx`, then cron:
`*/10 * * * * root EMAIL=ops@example.com /srv/bench/app/deploy/custom-domains/issue_certs.sh >> /srv/bench/logs/custom-certs.log 2>&1`.
Test with `STAGING=1` first. Certbot's own systemd timer renews certificates; nginx must be reloaded after renewal
(`--deploy-hook "systemctl reload nginx"` in `/etc/letsencrypt/renewal-hooks/deploy/`).

### Let's Encrypt limits (production endpoint)
50 new certificates per registered domain per week (a customer with many sub-domains is one registered domain), 5 duplicate certificates per week,
300 new orders per account per 3 hours, 5 failed validations per hostname per hour. The ask check and the script's per-run cap exist for this.
Use the staging endpoint (`acme_ca` line in the Caddyfile, `STAGING=1` for the script) for every experiment.

### Firewall and ports
Open `80/tcp` and `443/tcp` (and `443/udp` for HTTP/3 with Caddy) on the edge address. Keep `3101` (web), `8101` (API), PostgreSQL and Redis closed to the
internet (already so; bind to `127.0.0.1` or a private network only). The ACME HTTP challenge needs port 80 reachable from the internet.

## 5. Security model

* **Ownership proof.** A claim is worthless until the TXT record with its random token is found at `_bench-verify.<domain>`: only the DNS owner
  can publish it. A pending claim never serves, never blocks another company, and after 7 days expires. This replaces the earlier free-text
  field that let anyone type `google.com` (old values were migrated as *pending*, not verified).
* **First verified wins; no stealing.** The name is unique among `verified` and `dns_broken` claims (a database constraint, not just code).
  A company that loses its DNS records keeps the name for the grace period, then it is released.
* **Refused names.** IP addresses, `localhost` and private suffixes (`.local`, `.internal`, ...), wildcards, ports, URLs, bare public suffixes
  (`co.uk`, `github.io`, ... a short built-in list: the DNS proof is the real protection), and the Bench's own hosts and their parents.
* **Dangling DNS / subdomain takeover.** If a customer deletes the CNAME but we still hold the certificate, the name just stops reaching us. The
  other direction: a customer who cancels but leaves the CNAME pointing at Bench: the claim is removed or the plan lapses, `domains/allowed`
  answers 404, Caddy refuses a new certificate, requests that do reach the web app get a redirect to the Bench address (lapsed plan) or a plain 404.
  A *different* company cannot take that name over without publishing its own TXT token in the customer's zone.
* **Host header.** The web app trusts the `Host` header only to look the name up in the API. Unknown or malformed hosts get a plain 404 without
  any company data. Only the middleware sets `x-bench-custom-host`, `x-bench-custom-ws` and `x-bench-custom-root`; it removes them from every
  request that arrives, and the proxies blank them too. The pages hand the host to the API (`?host=`), and **the API refuses any card or
  directory that is not the company's**, so isolation does not depend on the web app alone.
* **No dashboard on customer domains.** `/app`, `/staff`, `/login`, `/register`, `/api/proxy`, `/api/session` and every other page of the Bench site
  redirect to the Bench host (or 404); only `/<card>`, `/c/<card>`, `/d/<slug>`, `/api/icons`, `/api/brand-info` and static files are served.
  The sign-in cookies are set for the Bench host only (no `Domain` attribute), so a customer domain never receives them.
* **ALLOWED_HOSTS / CSRF / CORS.** The browser on a customer domain talks to the **API host** directly for the public endpoints (card events, exchange
  form, vCard, QR). `/api/v1/public/` is already CORS-open (`*`, no credentials), so no `CORS_ALLOWED_ORIGINS` entry is needed, and customer domains
  must never be added to `CSRF_TRUSTED_ORIGINS` or `CORS_ALLOWED_ORIGINS` (those protect authenticated routes). The web server calls the API with the
  API's own host name, so Django's `ALLOWED_HOSTS` never needs a customer name; a request that reaches Django with a customer `Host` is rejected (400).
  Make sure the edge never forwards a customer `Host` to the API port.
* **The ask endpoint** is protected by `DOMAIN_ASK_TOKEN`, or (no token) only answers a caller on the same machine that sent no proxy header
  (a request through nginx always carries `X-Forwarded-For`). Do not publish it: `location = /api/v1/domains/allowed { return 404; }` on the public API
  server block is a good second lock (the Caddy ask goes straight to `127.0.0.1:8101`).
* **Resolve endpoint.** `GET /api/v1/domains/resolve?host=` is public, read-only, throttled (`domain_resolve`, 1200/min per caller; the web server is
  one caller) and answers only: verified, state, an opaque company id (not the database id), what `/` shows, the directory slug and the company card
  code. The web app keeps answers for 20 seconds (10 for unknown hosts) in a bounded memory cache.
* **Anything the visitor controls on the customer domain** (a card's lead form, events) goes to the API like on the Bench host, with the same throttles.

## 6. Operating it

* Cron: `check_custom_domains` hourly (in `deploy/cron/bench-cron`; `check_bench.sh` flags it when it has not run for 3 hours). By hand:
  `sudo -u bench .venv/bin/python manage.py check_custom_domains [--force]` and `list_custom_domains`.
* Django admin lists every claim (`Workspaces > Custom domains`: status, last error, last checked). Staff see the claim in the company's Brand tab.
* The company activity log shows `custom_domain.added`, `.verified`, `.broken`, `.removed`.
* **Remove a name quickly:** delete the claim in the admin (or ask the owner); the API stops allowing it within seconds (the web app's cache: 20 s).
  Caddy keeps an already issued certificate until it expires but the app answers 404/redirect; with nginx `issue_certs.sh` deletes the certificate.

### Troubleshooting
| Symptom | Check |
|---|---|
| "TXT not found" for a long time | `dig +short TXT _bench-verify.cards.northgate.com @1.1.1.1`; try the other name form (3); the TXT must be at that exact name, not on the bare domain |
| "TXT right, CNAME not found" | `dig +short CNAME cards.northgate.com`; on Cloudflare grey-cloud it; on a bare domain use A records |
| "DNS did not answer in time" | the server's resolver is slow: set `CARD_DOMAIN_DNS_SERVERS=1.1.1.1,8.8.8.8` |
| verified, but the browser shows a certificate error | Caddy: `journalctl -u caddy` (ask 404? DNS still pointing elsewhere? rate limit?). nginx: run `issue_certs.sh` by hand, check `/var/log/letsencrypt/letsencrypt.log` and that port 80 reaches nginx |
| verified, HTTPS fine, page is a 404 | `curl -s "https://<api>/api/v1/domains/resolve?host=cards.northgate.com"`: `state` must be `active`; `inactive` = plan lapsed; `unknown` = not verified/removed. Then check that the proxy passes `Host` unchanged |
| redirects to the Bench address | the company's Enterprise plan is not live (or the page is `/app...`) |
| a card shows 404 only on the domain | the card belongs to another company, or is a draft; the slug is not that company's |

## 7. Manual test plan on a staging domain (do this before the first customer)

You need: a throw-away domain you control (`staging-cards.example.net`), the Bench staging server, and an Enterprise test company.

1. Deploy the backend and web with this change (`deploy.sh`), run migrations, set `CARD_DOMAIN_CNAME_TARGET` to the edge host and `DOMAIN_ASK_TOKEN`.
   Check `systemctl status bench-api bench-web` and that `manage.py check_custom_domains` prints `Custom domains: checked 0 ...`.
2. Edge: Caddy staging (`acme_ca` uncommented) or nginx + `STAGING=1`. `curl -i "http://127.0.0.1:8101/api/v1/domains/allowed?token=<T>&domain=staging-cards.example.net"` must be `404`.
3. As the Enterprise owner open *Brand > Company and domain*, enter `staging-cards.example.net`. Expect status *Waiting for DNS* and two records with copy buttons.
4. Press *Check now* before adding anything: expect "We could not find the TXT record yet". In DNS add only the TXT, press *Check now*: expect "TXT right, cannot find the CNAME". Add the CNAME (grey cloud). Press *Check now*: status *Active*.
5. `curl` the ask URL again: `200 ok`. `curl -s "<api>/api/v1/domains/resolve?host=staging-cards.example.net"`: `verified: true`.
6. `https://staging-cards.example.net/<card-slug>` shows the card (staging certificate warning is expected). View source: `<link rel="canonical">` and `og:url` use the domain; `og:image` ends in `/<slug>/og.png`.
   The card's QR code (Brand > QR page, or `/api/v1/public/cards/<slug>/qr.svg`) scans to `https://staging-cards.example.net/<slug>?s=qr`.
7. `https://staging-cards.example.net/` shows the company directory (turn it on first) or the company card; with neither, a plain 404.
8. `https://staging-cards.example.net/<slug-of-a-card-of-another-company>` is a 404. `https://staging-cards.example.net/app` and `/login` redirect to the Bench host.
   No Bench sign-in cookie is sent to the staging domain (browser dev tools > Application > Cookies).
9. Second company: claim the same name as a pending claim (allowed), press *Check now* with its own token missing: it fails; it can never become active while the first holds the name.
10. Take the Enterprise plan away (staff back office grant/expire, or `Subscription.status='expired'` in a shell): within about 20 seconds the domain redirects to the Bench address of the same card; `domains/allowed` is `404`.
11. Restore the plan. Delete the TXT record, run `manage.py check_custom_domains --force` once a day for 3 days (or set `CARD_DOMAIN_BROKEN_DAYS=0` temporarily): the status becomes *DNS records missing*, the owner gets the e-mail (English and, for an Arabic user, Arabic), the domain still serves.
12. Remove the domain on the Brand page: the card addresses go back to the Bench address, the domain answers 404.
13. Switch Caddy/nginx to the production ACME endpoint only after all of the above worked.
