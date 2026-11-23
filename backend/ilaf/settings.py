"""Django settings. Everything that differs between machines comes from the environment."""
import os
from datetime import timedelta
from pathlib import Path

import dj_database_url
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent


def _load_env_file():
    """Read KEY=VALUE lines from a local .env file without overriding real environment variables."""
    path = BASE_DIR / ".env"
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_env_file()


def env(name, default=""):
    return os.environ.get(name, default)


def env_bool(name, default=False):
    value = os.environ.get(name)
    if value is None or value == "":
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


def env_list(name, default=""):
    return [part.strip() for part in env(name, default).split(",") if part.strip()]


# ---------------------------------------------------------------- brand
# The product and company names live here only. Everything visible (emails, admin,
# Stripe product names, the vCard note) reads them from these settings.
PRODUCT_NAME = env("PRODUCT_NAME", "BENCH")
PRODUCT_FULL_NAME = env("PRODUCT_FULL_NAME", "Business Enhancement Network Cloud Hub")
PRODUCT_TAGLINE = env("PRODUCT_TAGLINE", "Your business. One smart identity.")
COMPANY_NAME = env("COMPANY_NAME", "iLAF Technologies")
COMPANY_SITE = env("COMPANY_SITE", "https://ilaf.qa")
STATEMENT_DESCRIPTOR_SUFFIX = env("STATEMENT_DESCRIPTOR_SUFFIX", "ILAF TECH")
DEFAULT_VCARD_NOTE = f"Saved from my {PRODUCT_NAME} card"
COMPANY_SHORT_NAME = env("COMPANY_SHORT_NAME", "iLAF Tech")
BRAND_ORANGE = "#FF6B35"
BRAND_BLUE = "#3B82F6"
BRAND_GREEN = "#10B981"
BRAND_BLACK = "#101114"
BRAND_MUTED = "#666B75"
BRAND_BORDER = "#E8E9ED"
BRAND_BACKGROUND = "#FFFFFF"
BRAND_FONT = "Poppins, Arial, Helvetica, sans-serif"

# ---------------------------------------------------------------- core
DEBUG = env_bool("DEBUG", False)
SECRET_KEY = env("SECRET_KEY")
if not SECRET_KEY:
    if DEBUG:
        SECRET_KEY = "dev-only-insecure-key-change-me-0123456789abcdef0123456789"
    else:
        raise ImproperlyConfigured("Set SECRET_KEY in the environment (or in backend/.env).")

ALLOWED_HOSTS = env_list("ALLOWED_HOSTS", "localhost,127.0.0.1")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "corsheaders",
    "accounts",
    "workspaces",
    "billing",
    "cards",
    "leads",
    "analytics",
    "operations",
    "public",
    "privacy",
    "wallet",
    "staff",
    "designs",
    "publicapi",
    "crm",
    "guide",
    "support",
    "security",
    "notify",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    # Counts requests per minute for the staff health screen (one write per minute per process).
    "staff.metrics.RequestMetricsMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    # Opens CORS for the public endpoints before the stricter global CORS rules run.
    "ilaf.middleware.PublicCorsMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "ilaf.urls"
WSGI_APPLICATION = "ilaf.wsgi.application"
APPEND_SLASH = False

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ]
        },
    }
]

DATABASES = {
    "default": dj_database_url.config(
        default=f"sqlite:///{BASE_DIR / 'ilaf.sqlite3'}", conn_max_age=60
    )
}

AUTH_USER_MODEL = "accounts.User"
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 8}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = False
USE_TZ = True

# ---------------------------------------------------------------- static and media
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "/media/"
# A folder outside the code folder keeps uploads safe when the code is replaced during a deploy.
MEDIA_ROOT = Path(env("MEDIA_ROOT")) if env("MEDIA_ROOT") else BASE_DIR / "media"

STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedStaticFilesStorage"},
}
# An S3-compatible bucket (for example Cloudflare R2) replaces local media when a bucket is named.
if env("AWS_STORAGE_BUCKET_NAME"):
    STORAGES["default"] = {"BACKEND": "storages.backends.s3.S3Storage"}
    AWS_STORAGE_BUCKET_NAME = env("AWS_STORAGE_BUCKET_NAME")
    AWS_S3_ENDPOINT_URL = env("AWS_S3_ENDPOINT_URL") or None
    AWS_ACCESS_KEY_ID = env("AWS_ACCESS_KEY_ID")
    AWS_SECRET_ACCESS_KEY = env("AWS_SECRET_ACCESS_KEY")
    AWS_S3_REGION_NAME = env("AWS_S3_REGION_NAME", "auto")
    AWS_S3_CUSTOM_DOMAIN = env("AWS_S3_CUSTOM_DOMAIN") or None
    AWS_QUERYSTRING_AUTH = False
    AWS_DEFAULT_ACL = None

# ---------------------------------------------------------------- cache (needed by throttling)
if env("REDIS_URL"):
    CACHES = {"default": {"BACKEND": "django.core.cache.backends.redis.RedisCache", "LOCATION": env("REDIS_URL")}}
else:
    CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache", "LOCATION": "ilaf"}}

# ---------------------------------------------------------------- REST framework
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework_simplejwt.authentication.JWTAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": [
        "rest_framework.parsers.JSONParser",
        "rest_framework.parsers.MultiPartParser",
    ],
    "EXCEPTION_HANDLER": "ilaf.errors.api_exception_handler",
    # Per-person limits for the signed-in API (anonymous requests keep their own per-address throttles).
    "DEFAULT_THROTTLE_CLASSES": ["ilaf.throttles.UserApiThrottle"],
    "UNAUTHENTICATED_USER": None,
}

SIMPLE_JWT = {
    # A separate JWT_SIGNING_KEY keeps login tokens independent of SECRET_KEY (export links, visitor hashes).
    # Changing it signs everybody out. Empty means SECRET_KEY, as before.
    "SIGNING_KEY": env("JWT_SIGNING_KEY") or SECRET_KEY,
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=60),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=30),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": False,
    "AUTH_HEADER_TYPES": ("Bearer",),
}

# Requests per window for every throttled endpoint group. Overridable in tests.
ILAF_THROTTLE_RATES = {
    "auth_login": "20/min",
    "auth_register": "10/min",
    "auth_forgot": "5/min",
    "auth_reset": "10/min",
    "invite_accept": "10/min",
    "public_read": "240/min",
    "public_event": "120/min",
    "public_lead": "10/min",
    "slug_check": "60/min",
    "public_directory": "60/min",
    "resolve_link": "20/min",
    "auth_google": "20/min",
    "data_download": "30/min",
    # Support: the public contact form, starting a chat, polling a chat, and the inbound e-mail webhook.
    "support_public": "6/hour",
    "support_chat_start": "10/hour",
    "support_chat": "180/min",
    "support_inbound": "240/min",
    # Public forms of the back office: report a card, ask to talk to the team, unsubscribe.
    "public_report": "5/hour",
    "public_company_lead": "5/hour",
    # Signed-in API, per person: reads, writes, and the stricter groups (see ilaf/throttles.py).
    "user_read": "600/min",
    "user_write": "120/min",
    "user_heavy": "12/min",
    "user_sensitive": "10/min",
    "user_create": "60/hour",
}
# Optional override, for example THROTTLE_RATES_JSON='{"auth_login": "60/min"}' (only the named scopes change).
if env("THROTTLE_RATES_JSON"):
    import json

    ILAF_THROTTLE_RATES.update(json.loads(env("THROTTLE_RATES_JSON")))
# Sensitive account actions (linking Google, requesting an export) need a sign-in or password entry this recent.
REAUTH_WINDOW_SECONDS = int(env("REAUTH_WINDOW_SECONDS", "600"))

# Mails that must not slow a request (password reset) are sent from a background thread after the answer is ready.
EMAIL_AFTER_RESPONSE = env_bool("EMAIL_AFTER_RESPONSE", True)

# Behind nginx or another proxy, trust the forwarded client address for throttling and visitor hashes.
# Forwarded headers are read only when the TCP peer is one of TRUSTED_PROXY_IPS (addresses or CIDR ranges).
# NUM_PROXIES counts extra untrusted-looking proxy hops to skip on the right of X-Forwarded-For (normally 0).
# The website server sends the visitor address in X-BENCH-Client-IP; set CLIENT_IP_HEADER_SECRET (same value as
# in the web environment) to also require an HMAC signature in X-BENCH-Client-IP-Signature.
# TRUST_CLOUDFLARE_HEADER makes CF-Connecting-IP count; turn it on only when Cloudflare really is in front.
TRUST_PROXY_HEADERS = env_bool("TRUST_PROXY_HEADERS", False)
TRUSTED_PROXY_IPS = env_list("TRUSTED_PROXY_IPS", "127.0.0.1,::1")
NUM_PROXIES = int(env("NUM_PROXIES", "0") or 0)
CLIENT_IP_HEADER_SECRET = env("CLIENT_IP_HEADER_SECRET")
TRUST_CLOUDFLARE_HEADER = env_bool("TRUST_CLOUDFLARE_HEADER", False)
if TRUST_PROXY_HEADERS:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# ---------------------------------------------------------------- CORS
CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS", "http://localhost:3100")
CORS_ALLOW_HEADERS = ["accept", "accept-language", "authorization", "content-type", "origin", "x-language", "x-staff-token"]

# ---------------------------------------------------------------- app URLs
WEB_BASE_URL = env("WEB_BASE_URL", "http://localhost:3100").rstrip("/")
# Absolute URL of this API, used to build links to media and public files. Empty means "use the request host".
API_BASE_URL = env("API_BASE_URL", "").rstrip("/")

# ---------------------------------------------------------------- billing
STRIPE_SECRET_KEY = env("STRIPE_SECRET_KEY")
STRIPE_WEBHOOK_SECRET = env("STRIPE_WEBHOOK_SECRET")
CARDS_GRACE_DAYS = int(env("CARDS_GRACE_DAYS", "7"))
CARDS_DEV_ACTIVATE = env_bool("CARDS_DEV_ACTIVATE", False)

# ---------------------------------------------------------------- email
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", f"{PRODUCT_NAME} <no-reply@ilaf.qa>")
SERVER_EMAIL = DEFAULT_FROM_EMAIL
if env("EMAIL_HOST"):
    EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
    EMAIL_HOST = env("EMAIL_HOST")
    EMAIL_PORT = int(env("EMAIL_PORT", "587"))
    EMAIL_HOST_USER = env("EMAIL_HOST_USER")
    EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD")
    EMAIL_USE_TLS = env_bool("EMAIL_USE_TLS", True)
else:
    EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
# Browser tests read the mails from a folder. Only honoured while DEBUG is on, so production never writes mail to disk by mistake.
if DEBUG and env("EMAIL_FILE_PATH"):
    EMAIL_BACKEND = "django.core.mail.backends.filebased.EmailBackend"
    EMAIL_FILE_PATH = env("EMAIL_FILE_PATH")

# Company e-mails show the company logo only when its address is https; with this on, the server also checks (and
# remembers for six hours) that the logo can be fetched, and leaves it out when it cannot.
EMAIL_LOGO_CHECK = env_bool("EMAIL_LOGO_CHECK", False)

# ---------------------------------------------------------------- browser push notifications (Web Push, VAPID)
# Generate the pair once with `python manage.py generate_vapid_keys` and put the three values in the server's .env.
# While VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY is empty the opt-in button is hidden and nothing is sent.
VAPID_PUBLIC_KEY = env("VAPID_PUBLIC_KEY")
VAPID_PRIVATE_KEY = env("VAPID_PRIVATE_KEY")
VAPID_SUBJECT = env("VAPID_SUBJECT", "mailto:support@ilaf.qa")

# ---------------------------------------------------------------- limits
INVITE_LIFETIME_DAYS = 30
# Most rows one contacts spreadsheet may hold.
LEADS_CSV_MAX_ROWS = int(env("LEADS_CSV_MAX_ROWS", "50000"))
# Raw visitor events are kept this many days; older ones are rolled up by `manage.py prune_analytics`.
ANALYTICS_RETENTION_DAYS = int(env("ANALYTICS_RETENTION_DAYS", "400"))
# Where run_job.sh leaves its markers (ok-<job>, fail-<job>, last-<job>); the staff Jobs tab reads them.
BENCH_STATE_DIR = env("BENCH_STATE_DIR", "/srv/bench/state")
# Hours a card report may wait before it counts as late.
ABUSE_SLA_HOURS = int(env("ABUSE_SLA_HOURS", "48"))
# A support view ends by itself after this many minutes.
SUPPORT_VIEW_MINUTES = int(env("SUPPORT_VIEW_MINUTES", "30"))
# Addresses told about new design requests and new "Talk to us" applications (staff admins and support are told anyway for requests).
STAFF_NOTIFY_EMAILS = env_list("STAFF_NOTIFY_EMAILS")
# Tests turn this on: a staff write that leaves no audit event is then recorded as "staff.unlabelled_write".
STAFF_AUDIT_STRICT = False

PASSWORD_RESET_LIFETIME_HOURS = 2
MAX_UPLOAD_BYTES = 8 * 1024 * 1024
# Largest accepted picture in pixels (width x height); bigger files are refused before they are decoded.
IMAGE_MAX_PIXELS = int(env("IMAGE_MAX_PIXELS", "40000000"))
DATA_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"plain": {"format": "%(asctime)s %(levelname)s %(name)s %(message)s"}},
    # Tokens that travel in URLs (invite, data-download, unsubscribe) are masked before a line is written.
    "filters": {"mask_secrets": {"()": "ilaf.logfilters.MaskSecrets"}},
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "plain", "filters": ["mask_secrets"]},
        # The last 500 server errors, personal details removed, for the staff Errors tab.
        "recent_errors": {"class": "staff.errorlog.RecentErrorHandler", "level": "ERROR"},
    },
    "root": {"handlers": ["console", "recent_errors"], "level": env("LOG_LEVEL", "WARNING").upper()},
}

# Error monitoring is optional: with SENTRY_DSN set and the sentry-sdk package installed, unhandled errors are reported.
# No personal data is attached (send_default_pii stays off).
if env("SENTRY_DSN"):
    try:
        import sentry_sdk

        sentry_sdk.init(dsn=env("SENTRY_DSN"), environment=env("SENTRY_ENVIRONMENT", "production"),
                        traces_sample_rate=float(env("SENTRY_TRACES_SAMPLE_RATE", "0")), send_default_pii=False)
    except ImportError:
        pass

# ---------------------------------------------------------------- HTTPS hardening
# Production sets HTTPS_ONLY=true (behind nginx with TRUST_PROXY_HEADERS=true). It stays off by default so
# local development and the test suite keep working over plain http.
HTTPS_ONLY = env_bool("HTTPS_ONLY", False)
if HTTPS_ONLY:
    if not TRUST_PROXY_HEADERS:
        raise ImproperlyConfigured("HTTPS_ONLY needs TRUST_PROXY_HEADERS=true (the proxy tells Django the request was https).")
    # Settings that must never be on in production.
    if CARDS_DEV_ACTIVATE:
        raise ImproperlyConfigured("CARDS_DEV_ACTIVATE=true would give paid plans away for free: switch it off when HTTPS_ONLY is on.")
    if DEBUG:
        raise ImproperlyConfigured("DEBUG must be false when HTTPS_ONLY is on.")
    # Rate limits count in the cache; a per-process memory cache gives every worker its own counter.
    if not env("REDIS_URL") and not env_bool("ALLOW_LOCAL_THROTTLE_CACHE", False):
        raise ImproperlyConfigured("Set REDIS_URL so rate limits are shared by all workers (or ALLOW_LOCAL_THROTTLE_CACHE=true for a single process).")
    SECURE_SSL_REDIRECT = True
    SECURE_REDIRECT_EXEMPT = [r"^health/?$"]  # the local health check talks plain http to gunicorn
    SECURE_HSTS_SECONDS = int(env("SECURE_HSTS_SECONDS", "31536000"))
    SECURE_HSTS_INCLUDE_SUBDOMAINS = env_bool("SECURE_HSTS_INCLUDE_SUBDOMAINS", False)
    SECURE_HSTS_PRELOAD = env_bool("SECURE_HSTS_PRELOAD", False)
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"
X_FRAME_OPTIONS = "DENY"
# Needed only for the /admin/ login over https when the admin host differs from the Host header seen by Django.
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS")

# ---------------------------------------------------------------- Google sign-in and Google Wallet
# The OAuth client id of the web app (public, no secret). Empty turns Sign in with Google off.
GOOGLE_CLIENT_ID = env("GOOGLE_CLIENT_ID")
GOOGLE_JWKS_URL = env("GOOGLE_JWKS_URL", "https://www.googleapis.com/oauth2/v3/certs")
# Google Wallet passes: issuer id from the Google Pay & Wallet Console and a service account key
# (a file path, or the JSON itself for hosts that only offer environment variables).
GOOGLE_WALLET_ISSUER_ID = env("GOOGLE_WALLET_ISSUER_ID")
GOOGLE_WALLET_SERVICE_ACCOUNT_FILE = env("GOOGLE_WALLET_SERVICE_ACCOUNT_FILE")
GOOGLE_WALLET_SERVICE_ACCOUNT_JSON = env("GOOGLE_WALLET_SERVICE_ACCOUNT_JSON")
GOOGLE_WALLET_CLASS_SUFFIX = env("GOOGLE_WALLET_CLASS_SUFFIX", "bench_card")

# ---------------------------------------------------------------- privacy: export and deletion
# Export files are private (never under MEDIA_ROOT) and are removed after the link expires.
EXPORT_ROOT = env("EXPORT_ROOT", str(BASE_DIR / "private_exports"))
# Files sent with custom design requests are private too: never under MEDIA_ROOT, served only to signed-in people with access.
PRIVATE_FILES_ROOT = Path(env("PRIVATE_FILES_ROOT")) if env("PRIVATE_FILES_ROOT") else BASE_DIR / "private_files"
EXPORT_LINK_HOURS = 24
EXPORT_DAILY_LIMIT = 3
# Accounts up to this size are exported while the request waits; bigger ones are left for the
# `process_data_requests` command.
EXPORT_SYNC_MAX_CARDS = 15
EXPORT_SYNC_MAX_LEADS = 2000
DELETION_GRACE_DAYS = 14
DATA_REQUEST_DUE_DAYS = 30

# ---------------------------------------------------------------- public API keys
# The visible start of every API key (secret scanners recognise it). Keys made earlier keep working if this changes.
API_KEY_PREFIX = env("API_KEY_PREFIX", "bnch_live_")

# ---------------------------------------------------------------- CRM connectors (HubSpot, Salesforce, Zoho CRM)
# A connector's "Connect" button shows only when its client id and secret are set. Tokens are stored encrypted with a
# key derived from CRM_ENCRYPTION_KEY (set a long random value in production; changing it disconnects every CRM).
CRM_ENCRYPTION_KEY = env("CRM_ENCRYPTION_KEY")
HUBSPOT_CLIENT_ID = env("HUBSPOT_CLIENT_ID")
HUBSPOT_CLIENT_SECRET = env("HUBSPOT_CLIENT_SECRET")
SALESFORCE_CLIENT_ID = env("SALESFORCE_CLIENT_ID")
SALESFORCE_CLIENT_SECRET = env("SALESFORCE_CLIENT_SECRET")
# https://login.salesforce.com for production orgs; https://test.salesforce.com for sandboxes.
SALESFORCE_LOGIN_URL = env("SALESFORCE_LOGIN_URL", "https://login.salesforce.com")
ZOHO_CLIENT_ID = env("ZOHO_CLIENT_ID")
ZOHO_CLIENT_SECRET = env("ZOHO_CLIENT_SECRET")
# Zoho keeps each customer's data in one region: the owner picks it when connecting. Qatar and the Gulf use com or eu.
ZOHO_REGIONS = env_list("ZOHO_REGIONS", "com,eu,in")

if HTTPS_ONLY and not CRM_ENCRYPTION_KEY and any((HUBSPOT_CLIENT_ID, SALESFORCE_CLIENT_ID, ZOHO_CLIENT_ID)):
    raise ImproperlyConfigured("Set CRM_ENCRYPTION_KEY (a long random value) before enabling a CRM connector: it encrypts the CRM tokens.")

# ---------------------------------------------------------------- support (tickets, e-mail replies, live chat)
# Tickets are numbered PREFIX-00001. Outgoing support mail carries the number in the subject and uses SUPPORT_REPLY_TO as Reply-To.
SUPPORT_TICKET_PREFIX = env("SUPPORT_TICKET_PREFIX", "BNC")
SUPPORT_REPLY_TO = env("SUPPORT_REPLY_TO")
# The inbound webhook (/api/v1/support/inbound-email/) needs this shared secret in the X-Support-Secret header; empty turns it off.
SUPPORT_INBOUND_SECRET = env("SUPPORT_INBOUND_SECRET")
# The mailbox that `manage.py fetch_support_mail` reads over IMAP (SSL). Empty host means the command does nothing.
SUPPORT_IMAP_HOST = env("SUPPORT_IMAP_HOST")
SUPPORT_IMAP_PORT = int(env("SUPPORT_IMAP_PORT", "993"))
SUPPORT_IMAP_USER = env("SUPPORT_IMAP_USER")
SUPPORT_IMAP_PASSWORD = env("SUPPORT_IMAP_PASSWORD")
SUPPORT_IMAP_FOLDER = env("SUPPORT_IMAP_FOLDER", "INBOX")
SUPPORT_MAIL_MAX_BYTES = int(env("SUPPORT_MAIL_MAX_BYTES", str(15 * 1024 * 1024)))
# Where the internal SLA breach alerts go besides the admin accounts.
SUPPORT_ALERT_EMAILS = env_list("SUPPORT_ALERT_EMAILS")
