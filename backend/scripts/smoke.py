"""End-to-end smoke test through the real HTTP API.

Usage (server running in another terminal):
    python manage.py migrate
    python manage.py seed_plans
    python manage.py runserver 8100
    python scripts/smoke.py [http://localhost:8100]

It registers a brand-new user (so an empty database works and a used one does too), activates the
development plan, creates and publishes a card, then reads it as a visitor, downloads the vCard and
QR code, sends a lead and an event, and checks the analytics. It needs DEBUG=true with no
STRIPE_SECRET_KEY (or CARDS_DEV_ACTIVATE=true) so that checkout activates at once.
Uses only the Python standard library.
"""
import json
import sys
import time
import urllib.error
import urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8100").rstrip("/")
API = BASE + "/api/v1/"
steps = []


def call(method, path, body=None, token=None, headers=None, raw=False):
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(API + path, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    for key, value in (headers or {}).items():
        req.add_header(key, value)
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            payload = res.read()
            status, content_type = res.status, res.headers.get("Content-Type", "")
    except urllib.error.HTTPError as err:
        payload, status, content_type = err.read(), err.code, err.headers.get("Content-Type", "")
    if raw:
        return status, payload, content_type
    return status, (json.loads(payload) if payload else None)


def check(name, condition, detail=""):
    steps.append((name, bool(condition)))
    print(f"[{'ok' if condition else 'FAIL'}] {name}" + (f"  {detail}" if detail and not condition else ""))
    if not condition:
        print("Smoke test failed.")
        sys.exit(1)


def main():
    print(f"Smoke test against {BASE}")
    status, plans = call("GET", "plans")
    check("plans are listed", status == 200 and len(plans) >= 3, "run: python manage.py seed_plans")

    email = f"smoke{int(time.time())}@example.com"
    status, data = call("POST", "auth/register", {"email": email, "password": "smoke-pass-123", "full_name": "Smoke Tester"})
    check("register", status == 201 and "access" in data, data)
    token = data["access"]

    status, data = call("POST", "auth/login", {"email": email, "password": "smoke-pass-123"})
    check("login", status == 200 and data["user"]["email"] == email, data)

    status, workspaces = call("GET", "me/workspaces", token=token)
    check("personal workspace exists", status == 200 and workspaces[0]["kind"] == "personal", workspaces)
    ws = workspaces[0]["id"]
    check("no subscription yet", workspaces[0]["subscription"]["live"] is False)

    status, data = call("POST", f"workspaces/{ws}/cards", {"name": "Too Early"}, token=token)
    check("card creation needs a plan (402)", status == 402 and data["error"]["code"] == "subscription_required", data)

    status, data = call("POST", f"workspaces/{ws}/checkout", {"plan_code": "personal"}, token=token)
    check("dev plan activates at once", status == 200 and "paid=1" in data["checkout_url"],
          f"{data} (start the server with DEBUG=true and no STRIPE_SECRET_KEY)")
    status, sub = call("GET", f"workspaces/{ws}/subscription", token=token)
    check("subscription is live", sub["live"] is True and sub["plan_code"] == "personal", sub)

    card_body = {
        "name": "Smoke Tester", "title": "QA Lead", "company": "iLAF Technologies", "address": "West Bay, Doha",
        "slug": f"smoke-{int(time.time())}",
        "items": [
            {"kind": "Mobile", "value": "+974 5555 1111", "label": "Mobile"},
            {"kind": "WhatsApp", "value": "+974 5555 1111"},
            {"kind": "Email", "value": email},
            {"kind": "Instagram", "value": "@ilaf"},
            {"kind": "Custom", "value": "ilaf.qa/menu", "label": "Menu", "icon": {"type": "lucide", "key": "utensils"}},
        ],
        "design": {"face": 14, "colour": 1, "brand_colors": True},
    }
    status, card = call("POST", f"workspaces/{ws}/cards", card_body, token=token)
    check("create card", status == 201 and card["status"] == "draft", card)
    check("card has permanent public code", len(card["public_code"]) == 10)

    status, data = call("POST", f"workspaces/{ws}/cards", {"name": "Second"}, token=token)
    check("second card hits the plan limit (403)", status == 403 and data["error"]["code"] == "plan_limit", data)

    status, data = call("POST", f"cards/{card['id']}/publish", token=token)
    check("publish", status == 200 and data["status"] == "published", data)

    code, slug = card["public_code"], card["slug"]
    status, page = call("GET", f"public/cards/{code}")
    check("public page is live", status == 200 and page["state"] == "live" and page["canonical"] == slug, page)
    kinds = [i["kind"] for i in page["card"]["items"]]
    check("public items in order with links", kinds == ["Mobile", "WhatsApp", "Email", "Instagram", "Custom"]
          and page["card"]["items"][3]["href"] == "https://instagram.com/ilaf", page["card"]["items"])
    check("design is returned", page["card"]["design"]["face"] == 14)

    status, vcf, ctype = call("GET", f"public/cards/{slug}/vcard", raw=True)
    text = vcf.decode("utf-8")
    check("vCard downloads", status == 200 and ctype.startswith("text/vcard") and "BEGIN:VCARD" in text
          and "FN:Smoke Tester" in text and "item1.URL" in text, text[:200])

    status, svg, ctype = call("GET", f"public/cards/{code}/qr.svg?size=256", raw=True)
    check("QR code is an SVG", status == 200 and ctype.startswith("image/svg") and b"<svg" in svg)

    status, _ = call("POST", f"public/cards/{code}/events", {"type": "view", "source": "qr"})
    check("view event recorded (204)", status == 204)
    status, _ = call("POST", f"public/cards/{code}/events", {"type": "save"})
    check("save event recorded (204)", status == 204)
    status, _ = call("POST", f"public/cards/{code}/leads",
                     {"name": "Visitor", "email": "visitor@example.com", "website_url": ""})
    check("lead sent (201)", status == 201)
    status, _ = call("POST", f"public/cards/{code}/leads", {"name": "Bot", "email": "bot@example.com", "website_url": "x"})
    check("honeypot lead is accepted but dropped", status == 201)

    status, leads = call("GET", f"workspaces/{ws}/leads", token=token)
    check("exactly one lead stored", status == 200 and leads["count"] == 1, leads)

    status, stats = call("GET", f"workspaces/{ws}/analytics?days=7", token=token)
    totals = stats["totals"]
    check("analytics totals", status == 200 and totals["views"] == 1 and totals["scans"] == 1
          and totals["saves"] == 1 and totals["leads"] == 1, totals)

    status, data = call("POST", f"cards/{card['id']}/unpublish", token=token)
    check("unpublished card disappears for visitors", call("GET", f"public/cards/{code}")[0] == 404)
    status, data = call("GET", "public/cards/zzzzzzzzzz")
    check("unknown code is 404", status == 404 and data["error"]["code"] == "not_found")

    print(f"\nAll {len(steps)} smoke checks passed.")


if __name__ == "__main__":
    main()
