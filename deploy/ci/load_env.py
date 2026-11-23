"""Turn deploy/env.production.example into environment variables for a CI job.

Usage:  python deploy/ci/load_env.py >> "$GITHUB_ENV"        (KEY=VALUE lines)
Every CHANGE_ME value gets a throw-away stand-in so `manage.py check --deploy` sees a production-like configuration
(DEBUG off, HTTPS only, a real-looking secret key, hosts, CORS). Nothing here is a real secret.
"""
import re
import secrets
import sys
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / "env.production.example"
# Values the CI job sets itself (a throw-away database, no outgoing mail, no payment provider).
OVERRIDES = {
    "SECRET_KEY": "ci-" + secrets.token_urlsafe(48),
    "JWT_SIGNING_KEY": "ci-jwt-" + secrets.token_urlsafe(48),
    "EMAIL_HOST": "",
    "STRIPE_SECRET_KEY": "",
}


def main() -> None:
    for raw in SOURCE.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if not re.fullmatch(r"[A-Z][A-Z0-9_]*", key):
            continue
        if key in OVERRIDES:
            value = OVERRIDES[key]
        elif "CHANGE_ME" in value or "CHANGE-ME" in value:
            value = value.replace("CHANGE_ME", "ci-value").replace("CHANGE-ME", "ci-example")
        sys.stdout.write(f"{key}={value}\n")


if __name__ == "__main__":
    main()
