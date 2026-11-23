"""Create the test data a load test needs: one company with N published cards, contacts and visits, and a few signed-in users.

Run it ON THE MACHINE that has the database (the VPS, or your scratch copy), from the backend folder, with the same
environment as the API:

    cd /srv/bench/app/backend
    set -a; . /srv/bench/env/api.env; set +a
    /srv/bench/venv/bin/python ../deploy/loadtest/seed.py --cards 20 --users 5 --out /tmp/loadtest-seed.json

It writes the plan directly (no card payment) and marks everything with the e-mail domain `loadtest.invalid`, so
`--clean` can remove it again. Never run it with a database that holds only real customers' data you are unsure about:
it only ADDS rows (and --clean removes only the ones it created).
"""
import argparse
import json
import os
import sys
import time
import uuid

sys.path.insert(0, os.getcwd())
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "ilaf.settings")
import django  # noqa: E402

django.setup()

from django.conf import settings  # noqa: E402
from django.test import Client  # noqa: E402

DOMAIN = "loadtest.invalid"
PASSWORD = "Load-test-Passw0rd-1"


def call(client, method, path, body=None, token=None):
    kwargs = {"content_type": "application/json", "HTTP_HOST": settings.ALLOWED_HOSTS[0] if settings.ALLOWED_HOSTS else "localhost"}
    if token:
        kwargs["HTTP_AUTHORIZATION"] = f"Bearer {token}"
    fn = getattr(client, method)
    return fn(f"/api/v1/{path}", data=json.dumps(body), **kwargs) if body is not None else fn(f"/api/v1/{path}", **kwargs)


def clean():
    from accounts.models import User
    from workspaces.models import Workspace

    users = User.objects.filter(email__endswith="@" + DOMAIN)
    Workspace.objects.filter(members__user__in=users, kind="company").distinct().delete()
    count = users.count()
    users.delete()
    print(f"removed {count} load-test accounts and their companies")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cards", type=int, default=20)
    parser.add_argument("--users", type=int, default=5, help="signed-in users for the dashboard scenarios (each with own card)")
    parser.add_argument("--out", default="loadtest-seed.json")
    parser.add_argument("--clean", action="store_true", help="remove what an earlier seed created")
    args = parser.parse_args()
    if args.clean:
        return clean()

    from billing.models import Plan
    from billing.services import activate
    from workspaces.models import Workspace

    client = Client()
    tag = uuid.uuid4().hex[:8]
    owner_email = f"owner-{tag}@{DOMAIN}"
    res = call(client, "post", "auth/register", {"email": owner_email, "password": PASSWORD, "full_name": "Load Owner"})
    assert res.status_code == 201, res.content
    token = res.json()["access"]
    ws_id = call(client, "post", "workspaces", {"name": f"Load test {tag}"}, token=token).json()["id"]
    plan = Plan.objects.filter(kind="company", active=True).order_by("price_minor").first()
    activate(Workspace.objects.get(pk=ws_id), plan, args.cards + args.users + 2, source="loadtest")

    people = [f"card-{tag}-{i}@{DOMAIN}" for i in range(args.cards)] + [f"user-{tag}-{i}@{DOMAIN}" for i in range(args.users)]
    invited = call(client, "post", f"workspaces/{ws_id}/invites", {"invites": [{"email": e, "full_name": f"Load Person {i}"} for i, e in enumerate(people)]}, token=token)
    assert invited.status_code == 201, invited.content
    cards, users = [], []
    from workspaces.models import Member

    for i, member in enumerate(invited.json()):
        body = {
            "title": "Engineer", "company": "Load Co", "slug": f"lt-{tag}-{i}",
            "items": [{"kind": "Mobile", "value": "+974 5555 1111"}, {"kind": "Email", "value": member["email"]}, {"kind": "Instagram", "value": "@bench"}],
        }
        card = call(client, "patch", f"cards/{member['card_id']}", body, token=token)
        assert card.status_code == 200, card.content
        call(client, "post", f"cards/{member['card_id']}/publish", token=token)
        data = card.json()
        if i < args.cards:
            cards.append({"code": data["public_code"], "slug": data["slug"], "id": data["id"]})
        else:
            invite_token = Member.objects.get(pk=member["id"]).invite_token
            joined = client.post("/api/v1/invites/accept", data=json.dumps({"token": invite_token, "password": PASSWORD, "full_name": member["full_name"] or "Load User"}), content_type="application/json", HTTP_HOST="localhost")
            assert joined.status_code == 200, joined.content
            users.append({"email": member["email"], "password": PASSWORD, "workspace_id": ws_id, "card_id": member["card_id"]})
    for c in cards[: max(3, args.cards // 3)]:
        call(client, "post", f"public/cards/{c['code']}/leads", {"name": "Seed Visitor", "email": f"v@{DOMAIN}", "consent": True, "website_url": "", "opened_at": int(time.time() * 1000) - 10000})
        for _ in range(5):
            call(client, "post", f"public/cards/{c['code']}/events", {"type": "view", "source": "qr"})
    owner = {"email": owner_email, "password": PASSWORD, "workspace_id": ws_id}
    out = {"created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "workspace_id": ws_id, "owner": owner, "cards": cards, "users": users, "directory_slug": None}
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print(f"seeded {len(cards)} published cards, {len(users)} signed-in users, owner {owner_email} -> {args.out}")


if __name__ == "__main__":
    main()
