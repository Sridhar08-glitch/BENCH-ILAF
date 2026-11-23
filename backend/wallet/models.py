from django.db import models

from cards.models import Card


class WalletPass(models.Model):
    """One Google Wallet pass per card: what was last sent to Google and whether the card has changed since.

    The row survives the card (the card link is cleared) so the saved pass can still be switched off at Google.
    """

    card = models.OneToOneField(Card, null=True, blank=True, on_delete=models.SET_NULL, related_name="wallet_pass")
    object_id = models.CharField(max_length=120, unique=True)
    # SHA-256 of the pass JSON last sent to Google; an unchanged card is never sent again.
    last_synced_hash = models.CharField(max_length=64, blank=True, default="")
    last_synced_at = models.DateTimeField(null=True, blank=True)
    # True once Google is known to hold this pass (it was created or updated there).
    remote_exists = models.BooleanField(default=False)
    # The card changed (or was never sent) and the pass must be compared with it.
    dirty = models.BooleanField(default=False)
    card_deleted = models.BooleanField(default=False)
    last_error = models.CharField(max_length=300, blank=True, default="")
    attempts = models.PositiveIntegerField(default=0)
    next_try_at = models.DateTimeField(null=True, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.object_id
