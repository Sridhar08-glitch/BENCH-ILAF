"""Read the support mailbox over IMAP and add each new mail to its ticket (or open a new one).

Cron runs this every minute through deploy/run_job.sh, which takes a lock so two runs never overlap. With
SUPPORT_IMAP_HOST empty the command does nothing and succeeds, so the job can be installed before the mailbox exists.
"""
import imaplib
import logging

from django.conf import settings
from django.core.management.base import BaseCommand

from support import mailparse

log = logging.getLogger(__name__)
MAX_PER_RUN = 100


class Command(BaseCommand):
    help = "Fetch unread mail from the support mailbox (IMAP over SSL) into tickets."

    def handle(self, *args, **options):
        if not settings.SUPPORT_IMAP_HOST or not settings.SUPPORT_IMAP_USER:
            self.stdout.write("Support mailbox is not set up (SUPPORT_IMAP_HOST); nothing to do.")
            return
        counts = {"created": 0, "added": 0, "reopened": 0, "ignored": 0, "failed": 0}
        box = imaplib.IMAP4_SSL(settings.SUPPORT_IMAP_HOST, settings.SUPPORT_IMAP_PORT, timeout=30)
        try:
            box.login(settings.SUPPORT_IMAP_USER, settings.SUPPORT_IMAP_PASSWORD)
            box.select(settings.SUPPORT_IMAP_FOLDER)
            status, found = box.search(None, "UNSEEN")
            ids = (found[0].split() if status == "OK" and found and found[0] else [])[:MAX_PER_RUN]
            for num in ids:
                counts[self.one(box, num)] += 1
        finally:
            try:
                box.logout()
            except Exception:  # pragma: no cover - the connection may already be gone
                pass
        self.stdout.write("Support mail: " + ", ".join(f"{k}={v}" for k, v in counts.items()))

    def one(self, box, num):
        """Handle one mail. It is marked seen whatever happens, so a broken mail cannot block the mailbox."""
        try:
            status, size_data = box.fetch(num, "(RFC822.SIZE)")
            size = 0
            if status == "OK" and size_data and size_data[0]:
                part = size_data[0].decode() if isinstance(size_data[0], bytes) else str(size_data[0])
                digits = part.split("RFC822.SIZE")[-1].strip(" )")
                size = int(digits) if digits.isdigit() else 0
            if size > settings.SUPPORT_MAIL_MAX_BYTES:
                return "ignored"
            status, data = box.fetch(num, "(BODY.PEEK[])")
            if status != "OK" or not data or not isinstance(data[0], tuple):
                return "failed"
            result = mailparse.process_inbound(mailparse.parse_raw(data[0][1]))
            return result["status"] if result["status"] in ("created", "added", "reopened") else "ignored"
        except Exception:
            log.exception("Support mail could not be handled")  # no addresses or text are logged
            return "failed"
        finally:
            try:
                box.store(num, "+FLAGS", "\\Seen")
            except Exception:  # pragma: no cover
                pass
