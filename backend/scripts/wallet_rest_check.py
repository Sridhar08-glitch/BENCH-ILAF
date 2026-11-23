"""Manual check of the real Google Wallet connection. Not run by the tests and never run automatically.

Usage (from the backend folder, with the same environment as the server):
    python scripts/wallet_rest_check.py

It reads GOOGLE_WALLET_ISSUER_ID and the service account key from the environment, asks Google for an access
token and reads the pass class. It prints status codes and Google's error messages only, never a token or a key.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "ilaf.settings")

import django  # noqa: E402

django.setup()

from django.conf import settings  # noqa: E402
from urllib.parse import quote  # noqa: E402

from ilaf.errors import ApiError  # noqa: E402
from wallet import client, passes  # noqa: E402


def main():
    try:
        email, key = passes.load_service_account()
    except ApiError as exc:
        print(f"Setup problem: {exc.message}")
        return 1
    print(f"Service account: {email}")
    print(f"Issuer id: {settings.GOOGLE_WALLET_ISSUER_ID}")
    try:
        client.access_token(email, key)
        print("Token exchange: OK (200)")
    except client.WalletApiError as exc:
        print(f"Token exchange: FAILED (status {exc.status}) {exc.message}")
        return 1
    cid = passes.class_id(settings.GOOGLE_WALLET_ISSUER_ID)
    try:
        status, data = client.api("GET", "genericClass/" + quote(cid, safe=""), email, key)
    except client.WalletApiError as exc:
        print(f"Class {cid}: FAILED (status {exc.status}) {exc.message}")
        return 1
    if status == 200:
        print(f"Class {cid}: exists (200). Updates will work.")
        return 0
    if status == 404:
        print(f"Class {cid}: not found (404). It is created the first time a card asks for its save link.")
        return 0
    print(f"Class {cid}: {client.error_text(status, data)}")
    if status == 403:
        print("Check that the Google Wallet API is enabled and the service account is a user in the Wallet console.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
