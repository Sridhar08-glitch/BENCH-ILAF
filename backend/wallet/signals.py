"""Card and company changes mark the saved Google Wallet pass as changed. Each handler is one small query that
can never fail a card edit; the sending to Google happens later in the sync_wallet_passes job."""
from django.db.models.signals import post_save, pre_delete

from cards.models import Card
from workspaces.models import Workspace

from . import sync


def card_saved(sender, instance, created=False, update_fields=None, **kwargs):
    if created or (update_fields and set(update_fields) <= sync.IRRELEVANT_FIELDS):
        return
    sync.mark_dirty(instance)


def card_deleting(sender, instance, **kwargs):
    sync.mark_deleted(instance)


def workspace_saved(sender, instance, created=False, **kwargs):
    if not created:
        sync.mark_workspace_dirty(instance)


def connect():
    post_save.connect(card_saved, sender=Card, dispatch_uid="wallet_card_saved")
    pre_delete.connect(card_deleting, sender=Card, dispatch_uid="wallet_card_deleting")
    post_save.connect(workspace_saved, sender=Workspace, dispatch_uid="wallet_workspace_saved")
