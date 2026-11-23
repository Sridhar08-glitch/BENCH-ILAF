"""Run Django's deployment checks and fail on anything except the two choices the owner made on purpose.

Usage (from backend/, with the production-like environment loaded):  python ../deploy/ci/check_deploy.py
Accepted: security.W005 (HSTS for subdomains is off until every subdomain is known to be https-only) and
security.W021 (HSTS preload is off on purpose). Any other warning or error fails the job.
"""
import os
import sys

sys.path.insert(0, os.getcwd())
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "ilaf.settings")

import django  # noqa: E402

django.setup()
from django.core.checks import run_checks  # noqa: E402

ACCEPTED = {"security.W005", "security.W021"}
found = [m for m in run_checks(include_deployment_checks=True) if m.id not in ACCEPTED]
for message in found:
    print(f"{message.level_tag} {message.id}: {message.msg}")
print(f"deployment check: {len(found)} problem(s) outside the accepted list {sorted(ACCEPTED)}")
sys.exit(1 if found else 0)
