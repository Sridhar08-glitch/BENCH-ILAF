"""Custom domains (Enterprise): claim, DNS check, lifecycle and lookup.

The flow, in short (the full story is in deploy/CUSTOM_DOMAINS.md):

1. The owner claims a name. `set_domain` stores a PENDING `CustomDomain` with a random token. Several companies may hold a
   pending claim on the same name; nothing is served and nothing is blocked.
2. The owner adds two DNS records: TXT `_bench-verify.<domain>` = `bench-verify=<token>` (ownership) and a CNAME
   `<domain>` -> CARD_DOMAIN_CNAME_TARGET (traffic; an apex name may use A records from CARD_DOMAIN_A_RECORDS instead).
3. `check_domain` asks DNS (through a resolver object tests can replace). The first claim whose records are right becomes
   VERIFIED; from then on nobody else can verify that name (partial unique constraint on verified and dns_broken rows).
4. `check_custom_domains` (cron) re-checks pending claims for CARD_DOMAIN_PENDING_DAYS, then they expire, and re-verifies
   verified ones: records missing for CARD_DOMAIN_BROKEN_DAYS -> DNS_BROKEN and an e-mail to the owner; it keeps serving for
   CARD_DOMAIN_GRACE_DAYS more, then the name is released.
5. A name is SERVED only while the status holds the name AND the company is Enterprise-live (`billing.services.enterprise_allowed`).
"""
import ipaddress
import re
import secrets
import threading
from datetime import timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from ilaf.errors import ApiError

from .models import CustomDomain

TXT_LABEL = "_bench-verify"
TXT_PREFIX = "bench-verify="

# ---------------------------------------------------------------- normalising and refusing names
LABEL_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
TLD_RE = re.compile(r"^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$")
# Names that never exist on the public internet.
RESERVED_SUFFIXES = (".local", ".localhost", ".internal", ".invalid", ".onion", ".lan", ".home.arpa", ".example", ".corp", ".intranet")
# Suffixes that many unrelated sites share. Nobody can own them, so nobody may claim them as such (a claim *under* one, such
# as northgate.co.uk, is fine). Best effort and deliberately short: the DNS proof is what really protects a name.
PUBLIC_SUFFIXES = frozenset("""
co.uk org.uk me.uk ltd.uk plc.uk net.uk ac.uk gov.uk com.au net.au org.au edu.au gov.au co.nz org.nz co.za org.za co.in net.in
org.in com.br com.mx com.ar com.co com.tr com.sg com.my com.hk com.tw com.cn net.cn org.cn co.jp or.jp ne.jp co.kr or.kr
com.qa net.qa org.qa edu.qa gov.qa com.sa net.sa org.sa edu.sa gov.sa com.eg org.eg edu.eg gov.eg com.kw org.kw com.bh com.om
com.jo org.jo com.lb com.ae net.ae org.ae co.ae gov.ae co.il org.il com.pk com.ng co.ke co.tz
github.io gitlab.io herokuapp.com vercel.app netlify.app pages.dev workers.dev web.app firebaseapp.com appspot.com
cloudfront.net azurewebsites.net blob.core.windows.net blogspot.com wordpress.com wixsite.com squarespace.com
myshopify.com ngrok.io ngrok-free.app s3.amazonaws.com amazonaws.com cloudflare.net fly.dev onrender.com railway.app
""".split())


def own_hosts():
    """The hosts of this installation and anything an operator reserved: customers can never claim these or their parents."""
    from urllib.parse import urlsplit

    hosts = set(h.lower().rstrip(".") for h in settings.CARD_DOMAIN_RESERVED_HOSTS)
    for url in (settings.WEB_BASE_URL, settings.API_BASE_URL):
        host = (urlsplit(url).hostname or "").lower() if url else ""
        if host:
            hosts.add(host)
    if settings.CARD_DOMAIN_CNAME_TARGET:
        hosts.add(settings.CARD_DOMAIN_CNAME_TARGET)
    hosts.add("localhost")
    return hosts


def normalise_domain(raw):
    """A claimed name in its stored form: lower case, ASCII (IDN as punycode), no trailing dot. Refuses (400 invalid_domain)
    an empty or malformed value, a URL, a port, a wildcard, an IP address, localhost and other private names, a bare public
    suffix, and the host names of this installation (or their parents)."""
    value = (raw or "").strip().lower()
    if not value:
        raise ApiError("invalid_domain", "Enter a domain name such as cards.example.com.", 400)
    if "*" in value:
        raise ApiError("invalid_domain", "Wildcard domains are not allowed. Enter one exact domain such as cards.example.com.", 400)
    if "://" in value or any(ch in value for ch in "/?#@\\ "):
        raise ApiError("invalid_domain", "Enter only the domain name, without https:// or a path.", 400)
    # [::1] and a bare IPv6 address contain ":", so look for an address before the port rule.
    bare = value.strip("[]")
    try:
        ipaddress.ip_address(bare)
        raise ApiError("invalid_domain", "An IP address cannot be used. Enter a domain name such as cards.example.com.", 400)
    except ValueError:
        pass
    if ":" in value:
        raise ApiError("invalid_domain", "Remove the port number. Use only the domain name.", 400)
    value = value.rstrip(".")
    if not value:
        raise ApiError("invalid_domain", "Enter a domain name such as cards.example.com.", 400)
    if re.fullmatch(r"[0-9.]+", value):
        raise ApiError("invalid_domain", "An IP address cannot be used. Enter a domain name such as cards.example.com.", 400)
    try:
        value = value.encode("idna").decode("ascii")
    except UnicodeError:
        raise ApiError("invalid_domain", "This is not a valid domain name. Use a form such as cards.example.com.", 400)
    if len(value) > 253 or any(len(part) > 63 for part in value.split(".")):
        raise ApiError("invalid_domain", "A domain name has at most 253 characters, and each part between dots at most 63.", 400)
    labels = value.split(".")
    if len(labels) < 2:
        raise ApiError("invalid_domain", "Enter a full domain name such as cards.example.com.", 400)
    if not all(LABEL_RE.match(part) for part in labels) or not TLD_RE.match(labels[-1]):
        raise ApiError("invalid_domain", "This is not a valid domain name. Use a form such as cards.example.com.", 400)
    if value == "localhost" or any(value.endswith(suffix) for suffix in RESERVED_SUFFIXES):
        raise ApiError("invalid_domain", "This name cannot be used as a card domain.", 400)
    if value in PUBLIC_SUFFIXES:
        raise ApiError("invalid_domain", "Use a name under your own domain, for example cards.example.com. This one is shared by many websites.", 400)
    for host in own_hosts():
        if value == host or host.endswith("." + value) or value.endswith("." + host):
            raise ApiError("invalid_domain", "This name cannot be used as a card domain.", 400)
    return value


def is_apex(domain):
    """True for a name a CNAME is not allowed on: the registered name itself (example.com, northgate.co.uk)."""
    labels = domain.split(".")
    suffix = 1
    for n in (3, 2):
        if len(labels) > n and ".".join(labels[-n:]) in PUBLIC_SUFFIXES:
            suffix = n
            break
    else:
        if len(labels) > 2 and ".".join(labels[-2:]) in PUBLIC_SUFFIXES:
            suffix = 2
    return len(labels) == suffix + 1


# ---------------------------------------------------------------- DNS
class DnsLookupError(Exception):
    """The question could not be answered (timeout, server failure). Not the same as "no such record"."""


class DnsResolver:
    """What the checks need from DNS. Every method returns a list, [] when the name or record does not exist, and raises
    DnsLookupError when DNS itself failed. Tests pass a fake with the same three methods."""

    def txt(self, name):
        raise NotImplementedError

    def cname(self, name):
        """The direct CNAME target(s) of `name`, lower case, without the trailing dot."""
        raise NotImplementedError

    def addresses(self, name):
        """A and AAAA addresses of `name` (CNAMEs followed), as strings."""
        raise NotImplementedError


class DnspythonResolver(DnsResolver):
    def __init__(self, timeout=None, nameservers=None):
        import dns.resolver

        self._dns = dns.resolver
        self.resolver = dns.resolver.Resolver(configure=not nameservers)
        timeout = float(timeout if timeout is not None else settings.CARD_DOMAIN_DNS_TIMEOUT)
        self.resolver.timeout = timeout
        self.resolver.lifetime = timeout
        if nameservers:
            self.resolver.nameservers = list(nameservers)

    def _query(self, name, rdtype):
        try:
            return list(self.resolver.resolve(name, rdtype))
        except (self._dns.NXDOMAIN, self._dns.NoAnswer):
            return []
        except Exception as exc:  # timeout, SERVFAIL on every server, malformed answer
            if exc.__class__.__name__ in ("NoNameservers", "LifetimeTimeout", "Timeout"):
                raise DnsLookupError(str(exc) or exc.__class__.__name__) from exc
            raise DnsLookupError(f"{exc.__class__.__name__}: {exc}") from exc

    def txt(self, name):
        return ["".join(part.decode("utf-8", "replace") for part in rdata.strings) for rdata in self._query(name, "TXT")]

    def cname(self, name):
        return [str(rdata.target).rstrip(".").lower() for rdata in self._query(name, "CNAME")]

    def addresses(self, name):
        out = []
        for rdtype in ("A", "AAAA"):
            out += [rdata.address for rdata in self._query(name, rdtype)]
        return out


_resolver_override = None


def set_resolver(resolver):
    """Install a resolver for the whole process (tests). Pass None to go back to real DNS."""
    global _resolver_override
    _resolver_override = resolver


def get_resolver():
    if _resolver_override is not None:
        return _resolver_override
    return DnspythonResolver(nameservers=settings.CARD_DOMAIN_DNS_SERVERS or None)


# ---------------------------------------------------------------- what the owner must publish
def txt_name(domain):
    return f"{TXT_LABEL}.{domain}"


def txt_value(row):
    return f"{TXT_PREFIX}{row.token}"


def cname_target():
    return settings.CARD_DOMAIN_CNAME_TARGET


def dns_records(row):
    """The records to add, in the shape the screen shows them."""
    records = {
        "txt": {"type": "TXT", "name": txt_name(row.domain), "value": txt_value(row)},
        "cname": {"type": "CNAME", "name": row.domain, "value": cname_target()},
        "a": [{"type": "A", "name": row.domain, "value": ip} for ip in settings.CARD_DOMAIN_A_RECORDS],
        "apex": is_apex(row.domain),
    }
    return records


# ---------------------------------------------------------------- checking DNS
REASONS = {
    "txt_missing": "The TXT record was not found yet.",
    "txt_mismatch": "A TXT record exists at the verification name, but its value is not the one shown here.",
    "cname_missing": "The CNAME record was not found yet.",
    "cname_wrong": "The CNAME record points somewhere else.",
    "dns_error": "DNS did not answer in time. Try again in a few minutes.",
    "domain_taken": "Another company has already verified this domain.",
    "dns_released": "The DNS records stayed missing, so the domain was released.",
}


def _follow_cname(resolver, domain, target):
    """True when `domain` reaches `target` through CNAMEs (at most 5 hops). Returns (reached, first_hop_exists)."""
    seen, current, first = 0, domain, False
    while seen < 5:
        targets = resolver.cname(current)
        if not targets:
            break
        if current == domain:
            first = True
        if target in targets:
            return True, True
        current = targets[0]
        seen += 1
    return False, first


def check_dns(row, resolver=None):
    """Ask DNS about a claim. Returns {"ok", "reason", "txt_ok", "routing_ok"}; `reason` is a key of REASONS or None.
    The TXT record is checked first: ownership matters more than routing."""
    resolver = resolver or get_resolver()
    out = {"ok": False, "reason": None, "txt_ok": False, "routing_ok": False}
    try:
        values = [v.strip().strip('"') for v in resolver.txt(txt_name(row.domain))]
        if not values:
            out["reason"] = "txt_missing"
            return out
        if txt_value(row) not in values:
            out["reason"] = "txt_mismatch"
            return out
        out["txt_ok"] = True
        reached, first_hop = _follow_cname(resolver, row.domain, cname_target())
        if not reached and not first_hop and settings.CARD_DOMAIN_A_RECORDS:
            # No CNAME at all (an apex name): fixed server addresses are the alternative.
            if set(resolver.addresses(row.domain)) & set(settings.CARD_DOMAIN_A_RECORDS):
                reached = True
        if reached:
            out.update(ok=True, routing_ok=True)
        else:
            out["reason"] = "cname_wrong" if first_hop else "cname_missing"
    except DnsLookupError:
        out["reason"] = "dns_error"
    return out


# ---------------------------------------------------------------- lifecycle
def _days(n):
    return timedelta(days=n)


def get_row(workspace):
    return CustomDomain.objects.filter(workspace=workspace).first()


def _audit(request, workspace, action, row, extra=None):
    from operations import audit

    audit.log(request, workspace, action, "custom_domain", row.id, row.domain, {"domain": row.domain, **(extra or {})})


def set_domain(request, workspace, raw, user=None):
    """Claim `raw` for the company (replacing a different earlier claim). Enterprise only. Returns (row, created)."""
    from billing.services import require_enterprise

    if workspace.kind != "company":
        raise ApiError("validation_error", "A custom domain is only available on company workspaces.", 400)
    domain = normalise_domain(raw)  # a bad value is a 400 whatever the plan
    require_enterprise(workspace)
    row = get_row(workspace)
    if row is not None and row.domain == domain:
        if row.status in (CustomDomain.EXPIRED, CustomDomain.FAILED):
            row.status = CustomDomain.PENDING
            row.requested_at = timezone.now()
            row.last_error = ""
            row.save(update_fields=["status", "requested_at", "last_error"])
        return row, False
    holder = CustomDomain.objects.filter(domain=domain, status__in=CustomDomain.HOLDING).exclude(workspace=workspace).exists()
    if holder:
        raise ApiError("domain_taken", "This domain is already connected to another company.", 409)
    with transaction.atomic():
        if row is not None:
            old = row.domain
            row.delete()
            _audit(request, workspace, "custom_domain.removed", row, {"replaced": True, "domain": old})
        row = CustomDomain.objects.create(
            workspace=workspace, domain=domain, token=secrets.token_urlsafe(24), status=CustomDomain.PENDING,
            created_by=getattr(request, "user", None) if getattr(getattr(request, "user", None), "is_authenticated", False) else user,
        )
    _audit(request, workspace, "custom_domain.added", row)
    clear_memo()
    return row, True


def remove_domain(request, workspace):
    """Drop the claim (always allowed, plan or not). Returns True when there was one."""
    row = get_row(workspace)
    if row is None:
        return False
    was = row.status
    row.delete()
    _audit(request, workspace, "custom_domain.removed", row, {"was": was})
    clear_memo()
    return True


def _take(row, now):
    """Make a claim verified. False when somebody else holds the name by now."""
    if CustomDomain.objects.filter(domain=row.domain, status__in=CustomDomain.HOLDING).exclude(pk=row.pk).exists():
        return False
    row.status = CustomDomain.VERIFIED
    row.verified_at = now
    row.failing_since = None
    row.broken_at = None
    row.last_error = ""
    try:
        with transaction.atomic():
            row.save()
    except IntegrityError:
        return False
    return True


def check_domain(row, request=None, resolver=None, now=None, restart=False):
    """Run one DNS check and apply it to the row. `restart` (the owner pressed "Check now") gives an expired claim a fresh
    7-day window. Returns the DNS result dict."""
    now = now or timezone.now()
    result = check_dns(row, resolver)
    row.last_checked_at = now
    verified_now = False
    if row.status in CustomDomain.HOLDING:
        if result["ok"]:
            row.status = CustomDomain.VERIFIED
            row.failing_since = row.broken_at = None
            row.last_error = ""
        elif result["reason"] == "dns_error":
            row.last_error = "dns_error"  # DNS itself failed: neither a success nor proof the records are gone
        else:
            row.last_error = result["reason"]
            row.failing_since = row.failing_since or now
            if row.status == CustomDomain.VERIFIED and now - row.failing_since >= _days(settings.CARD_DOMAIN_BROKEN_DAYS):
                row.status = CustomDomain.DNS_BROKEN
                row.broken_at = now
                _notify_broken(row)
                _audit(request, row.workspace, "custom_domain.broken", row, {"reason": result["reason"]})
            elif row.status == CustomDomain.DNS_BROKEN and row.broken_at and now - row.broken_at >= _days(settings.CARD_DOMAIN_GRACE_DAYS):
                row.status = CustomDomain.FAILED
                row.last_error = "dns_released"
                _audit(request, row.workspace, "custom_domain.removed", row, {"released": True})
        row.save()
    else:
        if restart and row.status == CustomDomain.EXPIRED:
            row.requested_at = now
            row.status = CustomDomain.PENDING
        if result["ok"]:
            if _take(row, now):
                verified_now = True
            else:
                row.status = CustomDomain.FAILED
                row.last_error = "domain_taken"
                result.update(ok=False, reason="domain_taken")
        else:
            row.status = CustomDomain.FAILED
            row.last_error = result["reason"]
        row.save()
        if verified_now:
            _audit(request, row.workspace, "custom_domain.verified", row)
    clear_memo()
    return result


def expire_stale(now=None):
    """Pending and failed claims older than CARD_DOMAIN_PENDING_DAYS expire. Returns how many."""
    now = now or timezone.now()
    cutoff = now - _days(settings.CARD_DOMAIN_PENDING_DAYS)
    return CustomDomain.objects.filter(status__in=(CustomDomain.PENDING, CustomDomain.FAILED), requested_at__lt=cutoff).update(
        status=CustomDomain.EXPIRED,
    )


def run_checks(now=None, resolver=None, force=False):
    """The cron job: expire stale claims, re-check the open ones, re-verify verified ones that are due.
    Returns a summary dict."""
    from billing.services import enterprise_allowed

    now = now or timezone.now()
    resolver = resolver or get_resolver()
    summary = {"expired": expire_stale(now), "checked": 0, "verified": 0, "broken": 0, "released": 0}
    due = now - timedelta(hours=settings.CARD_DOMAIN_RECHECK_HOURS)
    rows = CustomDomain.objects.filter(status__in=(CustomDomain.PENDING, CustomDomain.FAILED, *CustomDomain.HOLDING)).select_related("workspace")
    for row in rows:
        if row.status in CustomDomain.HOLDING and not force and row.last_checked_at and row.last_checked_at > due:
            continue
        if row.status not in CustomDomain.HOLDING and not enterprise_allowed(row.workspace, now):
            continue  # a claim of a company that is not Enterprise (any more) is left to expire; it cannot take a name
        before = row.status
        try:
            check_domain(row, None, resolver, now)
        except Exception:  # one broken row must not stop the others
            import logging

            logging.getLogger(__name__).exception("custom domain check failed for %s", row.domain)
            continue
        summary["checked"] += 1
        if before not in CustomDomain.HOLDING and row.status == CustomDomain.VERIFIED:
            summary["verified"] += 1
        if before == CustomDomain.VERIFIED and row.status == CustomDomain.DNS_BROKEN:
            summary["broken"] += 1
        if before == CustomDomain.DNS_BROKEN and row.status == CustomDomain.FAILED:
            summary["released"] += 1
    return summary


def _notify_broken(row):
    """E-mail the owners (English or Arabic) that the DNS records are gone and the domain will stop working."""
    from billing.notices import owner_emails
    from ilaf.emails import send_brand_email
    from ilaf.i18n import language_for_email, tr

    ws = row.workspace
    for email in owner_emails(ws):
        lang = language_for_email(email)
        send_brand_email(
            email,
            tr(lang, "The DNS records for {domain} are missing", domain=row.domain),
            tr(lang, "Your custom domain needs attention"),
            [
                tr(lang, "{company} uses {domain} for its cards, but we cannot find its DNS records any more (the TXT record at {txt} or the CNAME to {target}).", company=ws.name, domain=row.domain, txt=txt_name(row.domain), target=cname_target()),
                tr(lang, "Your cards still work there for {days} more days. Add the records again to keep the domain, or the cards go back to the {product} address only.", days=settings.CARD_DOMAIN_GRACE_DAYS, product=settings.PRODUCT_NAME),
            ],
            tr(lang, "Open the domain settings"),
            f"{settings.WEB_BASE_URL}/app/brand",
            lang=lang,
        )


# ---------------------------------------------------------------- serving
def holds_name(row, now=None):
    """The claim owns the name and, for dns_broken, is still inside its grace period."""
    now = now or timezone.now()
    if row.status == CustomDomain.VERIFIED:
        return True
    if row.status == CustomDomain.DNS_BROKEN:
        return bool(row.broken_at) and now - row.broken_at < _days(settings.CARD_DOMAIN_GRACE_DAYS)
    return False


def serving_row(workspace, now=None):
    """The workspace's claim when it is being served right now (holds the name, company Enterprise-live, not erased), else None."""
    from billing.services import enterprise_allowed

    if workspace.kind != "company" or workspace.deleted_at is not None:
        return None
    row = get_row(workspace)
    if row is None or not holds_name(row, now) or not enterprise_allowed(workspace, now):
        return None
    return row


def host_state(host, now=None):
    """(row, state) for a host name: state "active" (serve it), "inactive" (a verified domain whose plan lapsed, or an erased
    company) or "unknown" (nobody holds it)."""
    host = (host or "").strip().lower().rstrip(".")
    if not host:
        return None, "unknown"
    row = CustomDomain.objects.filter(domain=host, status__in=CustomDomain.HOLDING).select_related("workspace").first()
    if row is None or not holds_name(row, now):
        return None, "unknown"
    if serving_row(row.workspace, now) is None:
        return row, "inactive"
    return row, "active"


def active_domain_names():
    """Every domain that is being served right now (for the certificate script), sorted."""
    names = []
    for row in CustomDomain.objects.filter(status__in=CustomDomain.HOLDING).select_related("workspace").order_by("domain"):
        if holds_name(row) and serving_row(row.workspace) is not None:
            names.append(row.domain)
    return names


def public_workspace_id(workspace_id):
    """An opaque id for a company that is safe to show in public answers (not the database id)."""
    import hashlib
    import hmac

    digest = hmac.new(settings.SECRET_KEY.encode(), f"domain-ws:{workspace_id}".encode(), hashlib.sha256).hexdigest()
    return "ws_" + digest[:16]


# ---------------------------------------------------------------- the address of a card
_state = threading.local()


def clear_memo():
    memo = getattr(_state, "memo", None)
    if memo is not None:
        memo.clear()


class RequestMemoMiddleware:
    """Keeps the answer of `domain_for` for one request only, so a list of 50 cards asks the database once."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        _state.memo = {}
        try:
            return self.get_response(request)
        finally:
            _state.memo = None


def domain_for(workspace):
    """The custom domain the workspace's public addresses should use, or None. Cheap for personal workspaces."""
    if workspace is None or workspace.kind != "company":
        return None
    memo = getattr(_state, "memo", None)
    if memo is not None and workspace.pk in memo:
        return memo[workspace.pk]
    row = serving_row(workspace)
    value = row.domain if row else None
    if memo is not None:
        memo[workspace.pk] = value
    return value


def card_address(card):
    """(base, path) of a card's public page: https://<custom domain>/<code> or <WEB_BASE_URL>/c/<code>."""
    code = card.slug or card.public_code
    host = domain_for(card.workspace)
    return (f"https://{host}", f"/{code}") if host else (settings.WEB_BASE_URL, f"/c/{code}")


def directory_url(workspace):
    """The company directory's public address: the custom domain's root, else /d/<slug>; None when there is no directory."""
    if not (workspace.directory_enabled and workspace.directory_slug):
        return None
    host = domain_for(workspace)
    return f"https://{host}/" if host else f"{settings.WEB_BASE_URL}/d/{workspace.directory_slug}"


# ---------------------------------------------------------------- what the screens and the API show
def info_json(workspace):
    """`custom_domain_info` of a workspace: the claim, what to add to DNS, and the last error. None without a claim."""
    row = get_row(workspace)
    if row is None:
        return None
    records = dns_records(row)
    return {
        "domain": row.domain,
        "status": row.status,
        "serving": serving_row(workspace) is not None,
        "verified_at": row.verified_at.isoformat().replace("+00:00", "Z") if row.verified_at else None,
        "last_checked_at": row.last_checked_at.isoformat().replace("+00:00", "Z") if row.last_checked_at else None,
        "last_error": row.last_error or None,
        "last_error_message": REASONS.get(row.last_error) if row.last_error else None,
        "expires_at": (row.requested_at + _days(settings.CARD_DOMAIN_PENDING_DAYS)).isoformat().replace("+00:00", "Z")
        if row.status in (CustomDomain.PENDING, CustomDomain.FAILED) else None,
        "grace_ends_at": (row.broken_at + _days(settings.CARD_DOMAIN_GRACE_DAYS)).isoformat().replace("+00:00", "Z")
        if row.status == CustomDomain.DNS_BROKEN and row.broken_at else None,
        "records": records,
        "url": f"https://{row.domain}/",
    }


def verified_domain_name(workspace):
    """The old `custom_domain` field of the workspace JSON: the verified domain or None (a claim that is only pending is not shown)."""
    row = get_row(workspace)
    return row.domain if row is not None and row.status in CustomDomain.HOLDING else None
