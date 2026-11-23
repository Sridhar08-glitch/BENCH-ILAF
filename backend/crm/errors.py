"""What can go wrong when talking to a CRM. Each error has a stable `code` the settings page shows in the visitor's
language (the English `message` is only a detail for the log and for support)."""


class CrmError(Exception):
    code = "crm_error"
    retry = False
    retry_after = 0
    status = 0

    def __init__(self, message="", retry_after=0, status=0):
        super().__init__(message)
        self.message = (message or "")[:250]
        self.status = status
        if retry_after:
            self.retry_after = retry_after


class AuthRevoked(CrmError):
    """The CRM no longer accepts our access (removed, revoked, or the refresh token is dead)."""

    code = "crm_auth_revoked"


class RateLimited(CrmError):
    code = "crm_rate_limited"
    retry = True
    retry_after = 60


class Unavailable(CrmError):
    code = "crm_unavailable"
    retry = True


class Forbidden(CrmError):
    """The connection lacks a permission the call needs."""

    code = "crm_forbidden"


class Rejected(CrmError):
    """The CRM refused the data (a required field, a value that is not allowed, ...). Retrying will not help."""

    code = "crm_rejected"


class BadMapping(Rejected):
    code = "crm_bad_mapping"


class TokenUnreadable(AuthRevoked):
    """The stored token cannot be decrypted (the encryption key changed): the owner has to connect again."""

    code = "crm_token_unreadable"


class OAuthFailed(CrmError):
    """The vendor did not give us a token when the owner connected (a wrong code, a wrong redirect address, ...)."""

    code = "crm_oauth_failed"
