"""Log filter that hides secrets which travel inside URLs (invite, data-download and unsubscribe links, query tokens).

Django logs the request path of every 4xx and 5xx answer, so without this an invalid or expired invite link would be
written to the log in full. Tokens sent in a request body never reach a log; this covers the older path forms.
"""
import logging
import re

_PATTERNS = [
    (re.compile(r"(/invites/)(?!lookup\b|accept\b|accept-google\b)[^/\s?\"']+"), r"\1<token>"),
    (re.compile(r"(/privacy/download/)(?!check\b)[^/\s?\"']+"), r"\1<token>"),
    (re.compile(r"(/(?:reset|restore|join|data-download)/)[^/\s?\"']{16,}"), r"\1<token>"),
    (re.compile(r"([?&](?:token|credential|id_token|access|refresh|password|key|code|state|client_secret|access_token|refresh_token)=)[^&\s\"']+"), r"\1<hidden>"),
    # API keys (any `<name>_live_<secret>` string) and bearer tokens never reach a log line.
    (re.compile(r"\b[a-z]{2,10}_live_[A-Za-z0-9_-]{12,}"), "<api-key>"),
    (re.compile(r"(?i)(bearer\s+)[A-Za-z0-9._~+/=-]{12,}"), r"\1<hidden>"),
]


def mask(text):
    for pattern, replacement in _PATTERNS:
        text = pattern.sub(replacement, text)
    return text


class MaskSecrets(logging.Filter):
    def filter(self, record):
        try:
            message = record.getMessage()
        except Exception:
            return True
        masked = mask(message)
        if masked != message:
            record.msg = masked
            record.args = None
        return True
