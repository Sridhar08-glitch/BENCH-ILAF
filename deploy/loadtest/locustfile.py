"""Load test for BENCH with Locust.

    pip install locust
    python ../deploy/loadtest/seed.py --cards 20 --users 5 --out loadtest-seed.json      (on the server, see README)
    LOADTEST_PROFILE=smoke  API_URL=https://api.YOURDOMAIN/api/v1 WEB_URL=https://app.YOURDOMAIN \
      locust -f deploy/loadtest/locustfile.py --headless --csv results/smoke

Settings (environment):
  API_URL, WEB_URL     where the API and the website are (WEB_URL empty = skip the page views)
  SEED_FILE            the file seed.py wrote (default loadtest-seed.json next to this file or the working folder)
  LOADTEST_PROFILE     smoke (20 users, 60 s) | normal (200 users, 8 min) | spike (1000 users, 4 min)
  P95_MS, P99_MS, MAX_FAIL_PERCENT   pass/fail limits; defaults below per profile. The process exits with code 1 when broken.
  DIRECTORY_SLUG       a company directory page to read (optional)
"""
import json
import os
import random
import time
from pathlib import Path

from locust import HttpUser, LoadTestShape, between, events, task

HERE = Path(__file__).resolve().parent
SEED_FILE = os.environ.get("SEED_FILE") or next((str(p) for p in (Path("loadtest-seed.json"), HERE / "loadtest-seed.json") if p.exists()), "loadtest-seed.json")
SEED = json.loads(Path(SEED_FILE).read_text(encoding="utf-8")) if Path(SEED_FILE).exists() else {"cards": [], "users": []}
API_URL = os.environ.get("API_URL", "http://localhost:8100/api/v1").rstrip("/")
WEB_URL = os.environ.get("WEB_URL", "").rstrip("/")
DIRECTORY_SLUG = os.environ.get("DIRECTORY_SLUG") or SEED.get("directory_slug")
PROFILE = os.environ.get("LOADTEST_PROFILE", "smoke").lower()

# (users, spawn rate per second, total seconds). The shape class below follows these steps.
PROFILES = {
    "smoke": {"steps": [(20, 5, 60)], "p95": 1500, "p99": 4000, "fail": 1.0},
    "normal": {"steps": [(50, 5, 60), (200, 10, 420)], "p95": 800, "p99": 2500, "fail": 0.5},
    "spike": {"steps": [(100, 20, 30), (1000, 100, 150), (100, 100, 60)], "p95": 2500, "p99": 8000, "fail": 2.0},
}
if PROFILE not in PROFILES:
    raise SystemExit(f"LOADTEST_PROFILE must be one of {sorted(PROFILES)}")
LIMITS = PROFILES[PROFILE]


class Shape(LoadTestShape):
    """Ramp up to each step's user count, hold, and stop after the last step."""

    def tick(self):
        run = self.get_run_time()
        elapsed = 0
        for users, rate, seconds in LIMITS["steps"]:
            elapsed += seconds
            if run < elapsed:
                return users, rate
        return None


class Visitor(HttpUser):
    """Somebody who scanned a QR code and opens a card: the card page, its data, the QR image, the contact file."""

    weight = 7
    host = API_URL
    wait_time = between(1, 4)

    def on_start(self):
        self.cards = SEED["cards"] or [{"code": "missing", "slug": "missing"}]

    @task(6)
    def card_page(self):
        if not WEB_URL:
            return
        card = random.choice(self.cards)
        self.client.get(f"{WEB_URL}/c/{card['code']}", name="web: GET /c/[code]")

    @task(5)
    def card_json(self):
        card = random.choice(self.cards)
        self.client.get(f"/public/cards/{card['code']}", name="api: GET public card")

    @task(3)
    def qr(self):
        card = random.choice(self.cards)
        self.client.get(f"/public/cards/{card['code']}/qr.png", name="api: GET qr.png")

    @task(2)
    def vcard(self):
        card = random.choice(self.cards)
        self.client.get(f"/public/cards/{card['slug']}/vcard", name="api: GET vcard")

    @task(4)
    def view_event(self):
        card = random.choice(self.cards)
        self.client.post(f"/public/cards/{card['code']}/events", json={"type": "view", "source": random.choice(["qr", "nfc", "link"])}, name="api: POST view event")

    @task(1)
    def directory(self):
        if WEB_URL and DIRECTORY_SLUG:
            self.client.get(f"{WEB_URL}/d/{DIRECTORY_SLUG}", name="web: GET /d/[slug]")
        elif DIRECTORY_SLUG:
            self.client.get(f"/public/directory/{DIRECTORY_SLUG}", name="api: GET directory")


class Exchanger(HttpUser):
    """A visitor who fills in the "share your details" form. Needs public_lead raised above the default 10/min per address."""

    weight = 1
    host = API_URL
    wait_time = between(3, 8)

    @task
    def send_details(self):
        card = random.choice(SEED["cards"] or [{"code": "missing"}])
        n = random.randint(1, 10**9)
        self.client.post(
            f"/public/cards/{card['code']}/leads",
            json={"name": f"Load Visitor {n}", "email": f"v{n}@loadtest.invalid", "consent": True, "website_url": "", "opened_at": int(time.time() * 1000) - 8000},
            name="api: POST lead",
        )


class SignedIn(HttpUser):
    """A card owner in the dashboard: sign in, open the card list, edit a card, read contacts and analytics."""

    weight = 2
    host = API_URL
    wait_time = between(2, 6)

    def on_start(self):
        people = SEED.get("users") or []
        if not people:
            self.environment.runner.quit()
            return
        self.person = random.choice(people)
        res = self.client.post("/auth/login", json={"email": self.person["email"], "password": self.person["password"]}, name="api: POST login")
        self.token = res.json().get("access", "") if res.status_code == 200 else ""
        self.headers = {"Authorization": f"Bearer {self.token}"}
        self.ws = self.person["workspace_id"]
        self.card_id = self.person["card_id"]

    @task(5)
    def workspaces(self):
        self.client.get("/me/workspaces", headers=self.headers, name="api: GET me/workspaces")

    @task(4)
    def card_list(self):
        self.client.get(f"/workspaces/{self.ws}/cards", headers=self.headers, name="api: GET cards list")

    @task(3)
    def card_detail(self):
        self.client.get(f"/cards/{self.card_id}", headers=self.headers, name="api: GET card")

    @task(2)
    def card_edit(self):
        self.client.patch(f"/cards/{self.card_id}", json={"title": f"Engineer {random.randint(1, 99)}"}, headers=self.headers, name="api: PATCH card")

    @task(2)
    def leads(self):
        self.client.get(f"/workspaces/{self.ws}/leads", headers=self.headers, name="api: GET leads")

    @task(2)
    def analytics(self):
        self.client.get(f"/workspaces/{self.ws}/analytics?days=30&tz=Asia/Qatar", headers=self.headers, name="api: GET analytics")


@events.quitting.add_listener
def check_limits(environment, **_kwargs):
    """Exit with a failing code when the run broke the limits of the profile."""
    total = environment.stats.total
    p95 = total.get_response_time_percentile(0.95) or 0
    p99 = total.get_response_time_percentile(0.99) or 0
    p95_limit = float(os.environ.get("P95_MS", LIMITS["p95"]))
    p99_limit = float(os.environ.get("P99_MS", LIMITS["p99"]))
    fail_limit = float(os.environ.get("MAX_FAIL_PERCENT", LIMITS["fail"]))
    fail = (100.0 * total.num_failures / total.num_requests) if total.num_requests else 100.0
    problems = []
    if p95 > p95_limit:
        problems.append(f"p95 {p95:.0f} ms is over {p95_limit:.0f} ms")
    if p99 > p99_limit:
        problems.append(f"p99 {p99:.0f} ms is over {p99_limit:.0f} ms")
    if fail > fail_limit:
        problems.append(f"{fail:.2f}% of requests failed (limit {fail_limit}%)")
    if total.num_requests == 0:
        problems.append("no requests were made (seed file missing?)")
    print(f"\n[{PROFILE}] requests={total.num_requests} p50={total.get_response_time_percentile(0.5):.0f} ms p95={p95:.0f} ms p99={p99:.0f} ms failed={fail:.2f}%")
    if problems:
        print("LOAD TEST FAILED: " + "; ".join(problems))
        environment.process_exit_code = 1
    else:
        print("LOAD TEST PASSED")
        environment.process_exit_code = 0
