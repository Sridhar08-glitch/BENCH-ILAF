"""A load test that needs nothing installed (Python standard library only), for when Locust is not available.

    python deploy/loadtest/light_runner.py --api https://api.YOURDOMAIN/api/v1 --seed loadtest-seed.json --users 20 --seconds 60

Each simulated person is a thread that loops through the same scenarios as the Locust file: card page data, QR image, contact
file, view events, contact form, and for signed-in people: card list, card edit, contacts and analytics. It prints p50 / p95 / p99
per endpoint and in total, and exits with code 1 when a limit is broken (--p95-ms, --max-fail-percent).
Standard-library threads are enough for a smoke run (20 to 100 people). For 200 or 1000 people use Locust.
"""
import argparse
import json
import random
import statistics
import sys
import threading
import time
import urllib.error
import urllib.request

results = []  # (name, milliseconds, ok)
lock = threading.Lock()


def request(base, method, path, name, body=None, token=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(base + path, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    start = time.perf_counter()
    ok, payload = False, b""
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            payload = res.read()
            ok = res.status < 400
    except urllib.error.HTTPError as err:
        ok = False
        payload = err.read()
    except Exception:
        ok = False
    elapsed = (time.perf_counter() - start) * 1000
    with lock:
        results.append((name, elapsed, ok))
    return ok, payload


def person(args, seed, stop_at, index):
    rnd = random.Random(index)
    cards = seed["cards"]
    token = None
    user = None
    if seed.get("users") and index % 3 == 0:
        user = rnd.choice(seed["users"])
        ok, payload = request(args.api, "POST", "/auth/login", "POST login", {"email": user["email"], "password": user["password"]})
        token = json.loads(payload).get("access") if ok else None
    while time.time() < stop_at:
        card = rnd.choice(cards)
        if token and user:
            ws = user["workspace_id"]
            for name, method, path, body in (
                ("GET me/workspaces", "GET", "/me/workspaces", None),
                ("GET cards list", "GET", f"/workspaces/{ws}/cards", None),
                ("PATCH card", "PATCH", f"/cards/{user['card_id']}", {"title": f"Engineer {rnd.randint(1, 99)}"}),
                ("GET leads", "GET", f"/workspaces/{ws}/leads", None),
                ("GET analytics", "GET", f"/workspaces/{ws}/analytics?days=30&tz=Asia/Qatar", None),
            ):
                request(args.api, method, path, name, body, token)
                time.sleep(rnd.uniform(0.5, 2))
        else:
            request(args.api, "GET", f"/public/cards/{card['code']}", "GET public card")
            request(args.api, "GET", f"/public/cards/{card['code']}/qr.png", "GET qr.png")
            request(args.api, "GET", f"/public/cards/{card['slug']}/vcard", "GET vcard")
            request(args.api, "POST", f"/public/cards/{card['code']}/events", "POST view event", {"type": "view", "source": "qr"})
            if rnd.random() < 0.15:
                n = rnd.randint(1, 10**9)
                request(args.api, "POST", f"/public/cards/{card['code']}/leads", "POST lead",
                        {"name": f"Load Visitor {n}", "email": f"v{n}@loadtest.invalid", "consent": True, "website_url": "", "opened_at": int(time.time() * 1000) - 8000})
            time.sleep(rnd.uniform(1, 3))


def percentile(values, p):
    if not values:
        return 0.0
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(round(p * (len(ordered) - 1))))]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", required=True)
    parser.add_argument("--seed", default="loadtest-seed.json")
    parser.add_argument("--users", type=int, default=20)
    parser.add_argument("--seconds", type=int, default=60)
    parser.add_argument("--p95-ms", type=float, default=1500)
    parser.add_argument("--max-fail-percent", type=float, default=1.0)
    args = parser.parse_args()
    args.api = args.api.rstrip("/")
    seed = json.load(open(args.seed, encoding="utf-8"))
    stop_at = time.time() + args.seconds
    threads = [threading.Thread(target=person, args=(args, seed, stop_at, i), daemon=True) for i in range(args.users)]
    for t in threads:
        t.start()
        time.sleep(0.1)
    for t in threads:
        t.join()

    names = sorted({r[0] for r in results})
    print(f"{'endpoint':<22}{'count':>7}{'p50':>8}{'p95':>8}{'p99':>8}{'fail%':>8}")
    for name in names + ["TOTAL"]:
        rows = results if name == "TOTAL" else [r for r in results if r[0] == name]
        times = [r[1] for r in rows]
        fails = 100.0 * sum(1 for r in rows if not r[2]) / len(rows)
        print(f"{name:<22}{len(rows):>7}{statistics.median(times):>8.0f}{percentile(times, .95):>8.0f}{percentile(times, .99):>8.0f}{fails:>8.2f}")
    times = [r[1] for r in results]
    fail_percent = 100.0 * sum(1 for r in results if not r[2]) / max(1, len(results))
    bad = []
    if percentile(times, .95) > args.p95_ms:
        bad.append(f"p95 over {args.p95_ms:.0f} ms")
    if fail_percent > args.max_fail_percent:
        bad.append(f"{fail_percent:.2f}% failed")
    print("LOAD TEST FAILED: " + ", ".join(bad) if bad else "LOAD TEST PASSED")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
