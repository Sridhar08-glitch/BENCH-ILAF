"""How many database queries does each main request run, and how long does it take?

Run from the backend folder, against a scratch database (never a real one):

    cd backend
    DEBUG=true SECRET_KEY=x DATABASE_URL=sqlite:///scratch.sqlite3 ALLOWED_HOSTS=testserver,localhost \
      python manage.py migrate && python manage.py seed_plans && python ../deploy/loadtest/query_counts.py

It creates one user with a company plan, N cards (default 20) with buttons, a few contacts, and visits. Each endpoint is
called through Django's test client (no network) and measured with CaptureQueriesContext. A number that grows when you add
more cards means a "one query per row" problem; the script calls each list endpoint with 5 and with N cards and prints both.
"""
import json
import os
import sys
import time
import uuid

sys.path.insert(0, os.getcwd())
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "ilaf.settings")

import django  # noqa: E402

django.setup()

from django.db import connection  # noqa: E402
from django.test import Client  # noqa: E402
from django.test.utils import CaptureQueriesContext  # noqa: E402

CARDS = int(os.environ.get("QC_CARDS", "20"))
PASSWORD = "query-count-Passw0rd"


def call(client, method, path, body=None, token=None, **extra):
    kwargs = {"content_type": "application/json", "HTTP_HOST": "localhost"}
    if token:
        kwargs["HTTP_AUTHORIZATION"] = f"Bearer {token}"
    kwargs.update(extra)
    data = json.dumps(body) if body is not None else None
    return getattr(client, method)(f"/api/v1/{path}", data=data, **kwargs) if data is not None else getattr(client, method)(f"/api/v1/{path}", **kwargs)


def measure(label, fn, rows):
    with CaptureQueriesContext(connection) as ctx:
        start = time.perf_counter()
        response = fn()
        elapsed = (time.perf_counter() - start) * 1000
    slowest = max((float(q["time"]) for q in ctx.captured_queries), default=0) * 1000
    print(f"{label:<44} rows={rows:<4} status={response.status_code} queries={len(ctx.captured_queries):<4} total={elapsed:7.1f} ms  slowest_query={slowest:6.1f} ms")
    return len(ctx.captured_queries)


def main():
    client = Client()
    tag = uuid.uuid4().hex[:8]
    email = f"qc-{tag}@example.com"
    res = call(client, "post", "auth/register", {"email": email, "password": PASSWORD, "full_name": "Query Counter"})
    assert res.status_code == 201, res.content
    token = res.json()["access"]
    wss = call(client, "get", "me/workspaces", token=token).json()
    ws = wss[0]["id"]
    # A company workspace lets one account own many cards.
    co = call(client, "post", "workspaces", {"name": f"QC {tag}"}, token=token)
    ws = co.json()["id"]
    call(client, "post", f"workspaces/{ws}/checkout", {"plan_code": "company", "seats": CARDS + 1}, token=token)

    # Every invited person gets a draft card; the owner fills and publishes them.
    invited = call(client, "post", f"workspaces/{ws}/invites", {"invites": [{"email": f"p{i}-{tag}@example.com", "full_name": f"Person {i}"} for i in range(CARDS)]}, token=token)
    assert invited.status_code == 201, invited.content
    codes = []
    for i, member in enumerate(invited.json()):
        body = {
            "name": f"Person {i}", "title": "Engineer", "company": "Query Co", "slug": f"qc-{tag}-{i}",
            "items": [
                {"kind": "Mobile", "value": "+974 5555 1111"}, {"kind": "Email", "value": f"p{i}@example.com"},
                {"kind": "WhatsApp", "value": "+974 5555 1111"}, {"kind": "Instagram", "value": "@bench"},
            ],
        }
        card = call(client, "patch", f"cards/{member['card_id']}", body, token=token)
        assert card.status_code == 200, card.content
        data = card.json()
        pub = call(client, "post", f"cards/{data['id']}/publish", token=token)
        assert pub.status_code == 200, pub.content
        codes.append((data["id"], data["public_code"], data["slug"]))
        if i < 5:
            for n in range(3):
                call(client, "post", f"public/cards/{data['public_code']}/events", {"type": "view", "source": "qr"})
    for card_id, code, _ in codes[:10]:
        call(client, "post", f"public/cards/{code}/leads", {"name": "Visitor", "email": "v@example.com", "consent": True, "website_url": "", "opened_at": int(time.time() * 1000) - 10000})

    print(f"\nDatabase: {connection.vendor}. {CARDS} cards, company workspace {ws}\n")
    card_id, code, slug = codes[0]
    worst = {}
    worst["public card (JSON)"] = measure("GET public card", lambda: call(client, "get", f"public/cards/{code}"), 1)
    worst["vcard"] = measure("GET vcard", lambda: call(client, "get", f"public/cards/{slug}/vcard"), 1)
    worst["qr.png"] = measure("GET qr.png", lambda: call(client, "get", f"public/cards/{code}/qr.png"), 1)
    worst["event"] = measure("POST view event", lambda: call(client, "post", f"public/cards/{code}/events", {"type": "view", "source": "link"}), 1)
    worst["lead"] = measure("POST lead (exchange form)", lambda: call(client, "post", f"public/cards/{code}/leads", {"name": "Q", "email": "q@example.com", "consent": True, "website_url": "", "opened_at": int(time.time() * 1000) - 10000}), 1)
    worst["login"] = measure("POST login", lambda: call(client, "post", "auth/login", {"email": email, "password": PASSWORD}), 1)
    worst["me workspaces"] = measure("GET me/workspaces", lambda: call(client, "get", "me/workspaces", token=token), 1)
    worst["cards list"] = measure("GET cards list", lambda: call(client, "get", f"workspaces/{ws}/cards", token=token), CARDS)
    worst["card detail"] = measure("GET card detail", lambda: call(client, "get", f"cards/{card_id}", token=token), 1)
    worst["card edit"] = measure("PATCH card (title)", lambda: call(client, "patch", f"cards/{card_id}", {"title": "Lead Engineer"}, token=token), 1)
    worst["leads list"] = measure("GET leads list", lambda: call(client, "get", f"workspaces/{ws}/leads", token=token), 10)
    worst["analytics"] = measure("GET analytics 30 days", lambda: call(client, "get", f"workspaces/{ws}/analytics?days=30", token=token), CARDS)
    worst["analytics people"] = measure("GET analytics/people", lambda: call(client, "get", f"workspaces/{ws}/analytics/people?days=30", token=token), CARDS)
    worst["members"] = measure("GET members", lambda: call(client, "get", f"workspaces/{ws}/members", token=token), 1)
    worst["directory"] = measure("GET public directory (if enabled)", lambda: call(client, "get", "public/directory/none-" + tag), 0)

    print("\nSummary (queries per request):")
    for name, n in sorted(worst.items(), key=lambda kv: -kv[1]):
        print(f"  {n:>4}  {name}")


if __name__ == "__main__":
    main()
