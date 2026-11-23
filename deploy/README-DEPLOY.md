# Putting BENCH on a server: step by step

For the founder. Every step has the exact commands. Copy them one block at a time, in order, and read what comes back.
Words in CAPITALS are things only you can fill in. Nothing here touches the other app on the server: BENCH has its own Linux user
(`bench`), its own folder (`/srv/bench`), its own database (`bench`), its own ports (8101 and 3101) and its own services
(`bench-api`, `bench-web`).

## What you need before you start

| Thing | Why |
|---|---|
| The server (the Contabo VPS, Ubuntu 24.04) and a login with `sudo` | Where BENCH runs |
| Two host names, for example `app.YOURDOMAIN` (the website) and `api.YOURDOMAIN` (the service behind it) | The card domain is not chosen yet: decide this first |
| Access to the DNS settings of that domain | To point both names at the server |
| A private Git repository that holds the BENCH folder (`backend`, `web`, `deploy`) | The server downloads the code from there. The folder is not a Git repository yet, see "Create the repository" |
| An e-mail account that can send mail (SMTP host, user, password) | Sign-up, password reset and lead e-mails are NOT delivered without it |
| An e-mail address for alarms | `ALERT_EMAIL` |
| Optional: Google sign-in client id, Google Wallet issuer id, Stripe keys | Leave empty: the matching feature is simply off |

Think of two kinds of commands: lines starting with `sudo` are typed on the server over SSH (`ssh YOUR-USER@SERVER-IP`).

### Create the repository (once, on your computer)

The BENCH folder is not under version control yet. Create a PRIVATE repository (for example on GitHub), put the whole BENCH folder
in it (the `.gitignore` in the folder keeps secrets, databases and build folders out), and push the branch `main`.
Never put a real `.env` file in it.

## Step 1. Look at the server first (changes nothing)

```
free -h
df -h /
sudo ss -ltn | grep -E ':(8101|3101)\b' || echo "ports 8101 and 3101 are free"
sudo systemctl list-units --type=service | grep -E 'nginx|postgres|redis'
```

You want: at least 2 GB of free memory, at least 10 GB of free disk, both ports free, and nginx, PostgreSQL and Redis listed.
If a port is taken, stop here and tell the developer: the port numbers live in `deploy/systemd/*.service`, `deploy/nginx/bench-http.conf`
and `env.web.production.example`.

## Step 2. Create the BENCH user and download the code

```
id bench >/dev/null 2>&1 || sudo useradd --system --create-home --home-dir /srv/bench --shell /bin/bash bench
sudo mkdir -p /srv/bench/.ssh
sudo chown bench:bench /srv/bench /srv/bench/.ssh
sudo chmod 700 /srv/bench/.ssh
sudo apt-get update && sudo apt-get install -y git
sudo -u bench ssh-keygen -t ed25519 -N "" -f /srv/bench/.ssh/id_ed25519
sudo cat /srv/bench/.ssh/id_ed25519.pub
```

Copy the line the last command prints. In your repository settings add it as a **Deploy key** (read-only). Then:

```
sudo -u bench sh -c 'ssh-keyscan github.com >> /srv/bench/.ssh/known_hosts'
sudo -u bench git clone git@github.com:YOUR-ORG/YOUR-REPO.git /srv/bench/app
sudo -u bench git -C /srv/bench/app checkout main
ls /srv/bench/app
```

The last command must list `backend`, `web` and `deploy`.

## Step 3. Prepare the server (one script)

```
sudo bash /srv/bench/app/deploy/setup_server.sh
```

It installs missing packages (Python, Node.js 22, nginx, certbot), creates the database `bench`, installs the services (not started yet),
the log rotation and the nginx building blocks. It reloads nginx only if `nginx -t` passes. You can run it again safely.

## Step 4. Point the host names at the server

In your DNS settings add two **A records** (and two AAAA records if the server has an IPv6 address) with the server's IP:

```
app.YOURDOMAIN   ->  SERVER-IP
api.YOURDOMAIN   ->  SERVER-IP
```

Wait a few minutes, then check from your computer or the server:

```
dig +short app.YOURDOMAIN
dig +short api.YOURDOMAIN
```

Both must print the server IP. (If you use Cloudflare, set both records to "DNS only" (grey cloud) for now.)

## Step 5. Fill in the two settings files

Backend settings:

```
sudo -u bench cp /srv/bench/app/deploy/env.production.example /srv/bench/app/backend/.env
sudo chmod 600 /srv/bench/app/backend/.env
python3 -c "import secrets; print(secrets.token_urlsafe(64))"
sudo -u bench nano /srv/bench/app/backend/.env
```

Paste the printed random text after `SECRET_KEY=`. Fill in every line marked `CHANGE_ME` or `CHANGE-ME`: the two host names
(`ALLOWED_HOSTS`, `WEB_BASE_URL`, `API_BASE_URL`, `CORS_ALLOWED_ORIGINS`), the e-mail settings and `ALERT_EMAIL`. Leave
`DEBUG=false`, `CARDS_DEV_ACTIVATE=false`, `HTTPS_ONLY=true`, `TRUST_PROXY_HEADERS=true`. Every line has a comment saying what it does
and what breaks without it. Save with Ctrl+O, Enter, Ctrl+X. **Keep a copy of the SECRET_KEY in a password manager.**

Web settings:

```
sudo -u bench cp /srv/bench/app/deploy/env.web.production.example /srv/bench/app/web/.env.production
sudo chmod 600 /srv/bench/app/web/.env.production
sudo -u bench nano /srv/bench/app/web/.env.production
```

Replace `CHANGE-ME.example` with your real names. `NEXT_PUBLIC_PUBLIC_HOST` is the short host shown in card addresses: until you have a card
domain, put your web host name there (`app.YOURDOMAIN`) so the displayed address at least opens. These values are baked into the website when it is
built; after changing one, run Step 6's deploy again.

Put the two nginx host names into the nginx files (replace the capitals):

```
sudo sed -i 's/__WEB_HOST__/app.YOURDOMAIN/g; s/__API_HOST__/api.YOURDOMAIN/g' /etc/nginx/sites-available/bench-bootstrap.conf /etc/nginx/sites-available/bench-web.conf /etc/nginx/sites-available/bench-api.conf /etc/nginx/snippets/bench-web-proxy.conf
```

## Step 6. First deploy

```
sudo bash /srv/bench/app/deploy/deploy.sh
```

It downloads dependencies, runs the checks, makes a backup, creates the database tables, loads the three starting plans, builds the website
(2 to 4 minutes) and starts the services. At the end it prints "Deployed ...". If it prints a red line, it already put everything back: copy the
message to the developer. Nothing is public yet (nginx does not serve BENCH until Step 7).

## Step 7. HTTPS (certificate) and going public

First let nginx answer on port 80 so the certificate authority can check you own the names:

```
sudo ln -sf /etc/nginx/sites-available/bench-bootstrap.conf /etc/nginx/sites-enabled/bench-bootstrap.conf
sudo nginx -t && sudo systemctl reload nginx
sudo certbot certonly --webroot -w /var/www/html --cert-name bench -d app.YOURDOMAIN -d api.YOURDOMAIN --email YOU@EXAMPLE.COM --agree-tos --no-eff-email
```

When certbot says "Successfully received certificate", switch to the real configuration:

```
sudo rm /etc/nginx/sites-enabled/bench-bootstrap.conf
sudo ln -sf /etc/nginx/sites-available/bench-api.conf /etc/nginx/sites-enabled/bench-api.conf
sudo ln -sf /etc/nginx/sites-available/bench-web.conf /etc/nginx/sites-enabled/bench-web.conf
sudo nginx -t && sudo systemctl reload nginx
printf '#!/bin/sh\nsystemctl reload nginx\n' | sudo tee /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh >/dev/null
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
sudo certbot renew --dry-run
```

`nginx -t` must say "syntax is ok" and "test is successful"; if it does not, do not reload: send the message to the developer.
Renewal is automatic (a system timer); the dry run proves it works.

Check from your computer:

```
curl -s https://api.YOURDOMAIN/health/
curl -sI https://app.YOURDOMAIN/ | head -n 5
```

The first must print `{"status": "ok", "database": "ok"}`. Raise the browser-security lifetime after one quiet week:
in `backend/.env` change `SECURE_HSTS_SECONDS=300` to `31536000`, then `sudo systemctl restart bench-api`.

## Step 8. Create the first administrator

```
sudo -u bench bash -c 'cd /srv/bench/app/backend && .venv/bin/python manage.py createsuperuser'
```

Answer the questions (use a long password, kept in a password manager). Sign in at `https://api.YOURDOMAIN/admin/`.
Use a different e-mail from your normal customer account.

Keep the accounts that can sign in to `/admin/` to the minimum: reading is not logged there. Restrict `/admin/` to the office or VPN addresses in nginx: copy the lines of `deploy/nginx/bench-admin-allow.conf.example` into the `location /admin/` block of `bench-api.conf` (replace the placeholder addresses), then `sudo nginx -t && sudo systemctl reload nginx`.

## Step 9. Starting data: plans

The deploy already created three placeholder plans (Personal, Business, Company). Check and set the real prices:

```
sudo -u bench bash -c 'cd /srv/bench/app/backend && .venv/bin/python manage.py shell -c "from billing.models import Plan; [print(p.code, p.price_minor, p.currency, p.max_cards) for p in Plan.objects.all()]"'
```

Edit prices in the admin (Billing > Plans). The deploy never overwrites prices you edited. Payments are parked: the checkout answers "not configured"
until Stripe keys are added, so to test with a real account give it a plan by hand:
admin > Billing > Subscriptions > Add: workspace = the account's workspace, plan = Personal, status = active, seats total = 1,
starts at = today, ends at = one year from now.

## Step 10. Smoke test (10 minutes)

1. Open `https://app.YOURDOMAIN`. The page loads with a padlock.
2. Register a new account. If you do not get the welcome or confirmation e-mail, `EMAIL_HOST` settings are wrong:
   `sudo -u bench bash /srv/bench/app/deploy/check_bench.sh` tells you.
3. Give the account a plan (Step 9), create a card, publish it, open `https://app.YOURDOMAIN/c/YOUR-CARD-NAME` in a private window.
4. On the public card press Save contact (a contact file downloads) and send the contact form. The owner gets an e-mail.
5. Upload a photo for the card: it shows (pictures come from `https://api.YOURDOMAIN/media/...`).
6. Dashboard > Analytics shows the visit.
7. Run the full report: `sudo -u bench bash /srv/bench/app/deploy/check_bench.sh`. Fix every `[FAIL]` line. (`[WARN]` for the cron jobs is normal until Step 11.)

## Step 11. Turn on scheduled jobs, backups and the alarm

```
sudo cp /srv/bench/app/deploy/cron/bench-cron /etc/cron.d/bench
sudo chmod 644 /etc/cron.d/bench
sudo -u bench bash /srv/bench/app/deploy/backup_db.sh
sudo bash /srv/bench/app/deploy/restore_drill.sh
```

The cron file runs every job in the table below. The backup line makes the first backup now; the drill restores it into a scratch database,
asks it a few questions, prints `DRILL OK` and deletes the scratch copy. Repeat the drill every month.

| Job | When (UTC) | What it does |
|---|---|---|
| deliver_webhooks | every minute | sends lead notifications to companies' own web addresses, retries failures |
| sync_crm | every minute | sends new leads to the companies' connected CRMs (HubSpot, Salesforce, Zoho CRM), refreshes tokens, retries failures |
| sync_wallet_passes | every 5 minutes | sends changed cards to the Google Wallet passes people saved (only passes whose card changed; failures retried with growing waits); does nothing until Google Wallet is set up |
| fetch_support_mail | every minute | reads the support mailbox (IMAP) and adds new mail to tickets; does nothing until `SUPPORT_IMAP_HOST` is set |
| support_tick | every minute | support clock: unanswered chats become tickets, idle chats end, staff presence times out, SLA alerts go to admins, solved tickets close after 14 days |
| prune_api_idempotency | daily | forgets API idempotency records older than 24 hours |
| send_announcements | every 5 minutes | sends due announcement e-mails in batches of 200 (one row per person, so a repeated run sends nothing twice; product updates only to people who agreed) |
| expire_support_views | every 5 minutes | ends support views whose 30 minutes ran out and writes the end to the company's Activity log |
| prune_back_office | daily 03:55 | removes old request metrics (7 days), e-mail log rows (90 days), saved bodies of failed e-mails (14 days) and trims the error list to 500 |
| process_data_requests | every 5 minutes | builds big data exports and e-mails the download links |
| cleanup_data_exports | hourly | deletes download files after use or after 24 hours |
| purge_deleted_accounts | daily 03:10 | erases accounts and companies after their 14 days of grace |
| expire_subscriptions | daily 03:20 | ends plans after the grace days |
| flushexpiredtokens | daily 03:30 | cleans old sign-in tokens from the database |
| prune_analytics | daily 03:40 | rolls visit events older than 400 days into summary rows, deletes webhook deliveries older than 90 days, old reset rows and expired invitation links |
| send_renewal_reminders | daily 07:00 | e-mails owners 7 days and 1 day before a plan ends |
| send_weekly_reports | Monday 07:00 | weekly report e-mails (sending twice is impossible) |
| send_daily_summary | hourly (at :05) | the daily summary e-mail, sent to each person who switched it on during their own morning (7 to 11 local time, `Asia/Qatar` when they set no time zone); one per person per day, so running it often is harmless |
| prune_security | daily 03:55 | deletes sign-in device rows idle for 31 days, expired "remember this device" entries, old security events, dead push subscriptions, expired domain confirmations |
| clearsessions | Sunday 04:00 | cleans old admin sessions |
| backup_db | daily 02:30 | database backup, 14 days kept |
| backup_media | Sunday 03:45 | pictures backup, 4 weeks kept |
| alert_down | every minute | e-mails you when the site fails two checks in a row |
| check_bench --mail-daily | daily 06:05 | e-mails you only if something is wrong |

A missed run is harmless (the next run catches up). Jobs never overlap (`flock`). Follow what they did: `tail -n 50 /srv/bench/logs/jobs.log`.

**Copy backups off the server.** A backup on the same disk is lost with the server. Create a bucket (for example Cloudflare R2), set it up with `rclone config`,
then put one line into `/etc/bench-backup.env`: `BACKUP_REMOTE=myremote:bench-backups`.

## Support mailbox (ticket e-mail replies) and live chat

Customers write to support in the app (`/app/support`) and on the public page `/contact`. Staff answer in the staff area
(Support inbox). Every answer goes to the customer by e-mail and a reply to that e-mail lands back in the same ticket.
Live chat needs nothing extra: it uses the same servers (short polling, no new software).

What you (the owner) do once:

1. **Create the mailbox.** At your e-mail host make `support@ilaf.qa` (a real mailbox, not only a forward). Turn IMAP on for it and note the
   IMAP server name (for example `imap.yourhost.com`), the user name (usually `support@ilaf.qa`) and the password.
2. **Put the settings into `/srv/bench/app/backend/.env`** (same file as the other settings), then restart: `sudo systemctl restart bench-api`.

   ```
   SUPPORT_REPLY_TO=support@ilaf.qa
   SUPPORT_IMAP_HOST=imap.yourhost.com
   SUPPORT_IMAP_PORT=993
   SUPPORT_IMAP_USER=support@ilaf.qa
   SUPPORT_IMAP_PASSWORD=the-mailbox-password
   SUPPORT_IMAP_FOLDER=INBOX
   SUPPORT_ALERT_EMAILS=you@ilaf.qa
   ```

   `SUPPORT_REPLY_TO` is the address customers answer to (it is set as Reply-To on every support e-mail). `SUPPORT_ALERT_EMAILS` also gets the
   "deadline missed" alerts (admins get them anyway). Optional: `SUPPORT_TICKET_PREFIX` (default `BNC`) is the ticket number prefix.
3. **Check the mailbox is read:** `sudo -u bench /srv/bench/app/backend/.venv/bin/python /srv/bench/app/backend/manage.py fetch_support_mail`
   prints `Support mail: created=... added=...`. The cron file already runs it every minute (see the job table in step 11); mail is marked as read
   after it is handled, so nothing is added twice.
4. **SPF and DKIM (so replies are not marked as spam).** The mail the app sends comes from `DEFAULT_FROM_EMAIL` through your SMTP service. At your
   DNS host make sure the domain `ilaf.qa` has an SPF record that includes your SMTP service and your mailbox host (one record only, for example
   `v=spf1 include:_spf.yoursmtp.com include:_spf.yourhost.com ~all`) and turn on DKIM for both services (each shows you a DKIM record to add).
   Ask your hosts for the exact lines; test by sending a ticket to a Gmail address and choosing "Show original": SPF and DKIM must say PASS.
5. **Business hours and replies.** In the staff area open Support settings: set the working days and hours (default Sunday to Thursday 09:00 to 17:00,
   Asia/Qatar), the holidays, the "nobody is online" texts in English and Arabic, the deadlines per priority, and the saved replies.

Instead of IMAP you may let a mail provider push mail: send each incoming mail as JSON (`from`, `to`, `subject`, `text`, `message-id`, `in-reply-to`,
`references`, `attachments`) to `POST /api/v1/support/inbound-email/` with the header `X-Support-Secret: <SUPPORT_INBOUND_SECRET>` (set a long random value in `.env`;
without it the address answers 404).

Private files of tickets and chats are stored in `PRIVATE_FILES_ROOT` (the same private folder as design request files); the backup scripts must include it.

## How to update (every time the code changes)

On your computer: push to the `main` branch. On the server:

```
sudo bash /srv/bench/app/deploy/deploy.sh
```

It repeats the safe sequence: pull, dependencies, check, **backup (a failed backup stops everything)**, migrate, build, restart the API, check it, restart
the website, check it. A short pause of a few seconds happens at each restart. To deploy another branch: `sudo BRANCH=release bash /srv/bench/app/deploy/deploy.sh`.

## How to roll back

Automatic: if the API or the website does not answer after the restart, `deploy.sh` puts the previous code and the previous website build back and
says "Deploy rolled back". Database changes are not undone (new code is written so old code still works with them).

By hand, to go back to an older version later (find it with `sudo -u bench git -C /srv/bench/app log --oneline | head`):

```
sudo -u bench git -C /srv/bench/app reset --hard COMMIT-ID
sudo -u bench bash -c 'cd /srv/bench/app/backend && .venv/bin/pip install -r requirements.txt'
sudo -u bench bash -c 'cd /srv/bench/app/web && npm ci && npm run build'
sudo systemctl restart bench-api && sudo systemctl restart bench-web
```

(The next `deploy.sh` goes back to the newest `main` commit.) If a new database change is the problem, restore the backup instead (next section).

## How to restore a backup

Practice first: `sudo bash /srv/bench/app/deploy/restore_drill.sh` (changes nothing real). For a real emergency (database lost or damaged):

```
ls -lt /srv/bench/backups | head
sudo systemctl stop bench-api bench-web
sudo -u postgres dropdb bench
sudo -u postgres createdb -O bench -E UTF8 bench
sudo -u postgres pg_restore --no-owner --role=bench -d bench < /srv/bench/backups/FILE-NAME.dump
sudo systemctl start bench-api && sudo systemctl start bench-web
curl -s https://api.YOURDOMAIN/health/
```

Everything created after the backup is lost, so take the newest file. Pictures: `sudo -u bench tar -xzf /srv/bench/backups/media_DATE.tar.gz -C /srv/bench/data`.
New server entirely: repeat Steps 1 to 7 on it, put the same `.env` files back (`SECRET_KEY` must be identical, otherwise everyone is signed out and old export links stop working),
restore the database and the pictures as above.

## Day to day

| I want to | Command |
|---|---|
| See if everything is fine | `sudo -u bench bash /srv/bench/app/deploy/check_bench.sh` |
| Read the latest report without running it | `cat /srv/bench/state/status.txt` |
| See errors of the service | `journalctl -u bench-api -n 100` and `journalctl -u bench-web -n 100` |
| Restart | `sudo systemctl restart bench-api` / `sudo systemctl restart bench-web` |
| See the web requests | `sudo tail -n 50 /var/log/nginx/bench-web.access.log` |
| See job results | `tail -n 50 /srv/bench/logs/jobs.log` |
| Change a setting | edit `/srv/bench/app/backend/.env`, then `sudo systemctl restart bench-api`. For `web/.env.production` run `deploy.sh` (some values are baked in at build time) |

## Browser notifications (VAPID keys), the daily summary and the new security tables
1. `deploy.sh` runs the migrations (new apps `security` and `notify`, and `cards` 0010: card label, order, default).
2. Browser push needs no extra package. Make the key pair once: `cd /srv/bench/app/backend && .venv/bin/python manage.py generate_vapid_keys` and paste the three lines into `/srv/bench/app/backend/.env` (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:you@your-domain`), then `sudo systemctl restart bench-api`. Until both keys are set the opt-in button is hidden and nothing is sent. Never change the keys later: every subscribed browser would stop receiving notifications.
3. Install the cron file again (`sudo cp deploy/cron/bench-cron /etc/cron.d/bench`): it adds `send_daily_summary` (hourly) and `prune_security` (daily).
4. Company e-mails: set `EMAIL_LOGO_CHECK=1` in `.env` so a company logo that cannot be fetched is left out of its e-mails.
5. nginx: copy `deploy/nginx/bench-api.conf` again and reload: uploaded PDFs under `/media/files/` are always downloaded and never shown inside the site. With a storage bucket set the same `Content-Disposition: attachment` header on `files/`.
6. The web app must be rebuilt (`deploy.sh`): new pages, service worker version 2 (people see "Update available" once).

## Card domain (later)

The card link is `https://app.YOURDOMAIN/c/NAME` (set by `WEB_BASE_URL`). When the short card domain is chosen: set `NEXT_PUBLIC_PUBLIC_HOST` to it, add
its DNS record, add a third nginx server block that redirects `/NAME` to `https://app.YOURDOMAIN/c/NAME` (an example is in the header of `nginx/bench-web.conf`),
get a certificate for it (`certbot certonly ... -d CARDDOMAIN`), and deploy. Until the redirect exists the short address shown in the dashboard does not open.

## Using Cloudflare in front (optional)

1. Turn the orange cloud on for both names. 2. In `bench-http.conf` there is nothing to change, but in `bench-proxy.conf` and `bench-web-proxy.conf` replace
`proxy_set_header X-Forwarded-For $remote_addr;` by using the nginx real-IP module: add to `/etc/nginx/conf.d/bench-http.conf` one `set_real_ip_from` line for every
range listed at https://www.cloudflare.com/ips/ and `real_ip_header CF-Connecting-IP;` (then `$remote_addr` is the visitor's real address). 3. Block everything except
Cloudflare on ports 80 and 443 in the firewall, otherwise the header can be forged. Without Cloudflare leave everything as delivered.

## Files in this folder

`env.production.example`, `env.web.production.example` (settings), `systemd/` (services), `cron/bench-cron` (jobs), `nginx/` (web server), `deploy.sh`,
`setup_server.sh`, `backup_db.sh`, `backup_media.sh`, `restore_drill.sh`, `check_bench.sh`, `alert_down.sh`, `run_job.sh`, `bench_lib.sh`,
`PRODUCTION_READINESS.md` (what must be fixed before real customers).
