from django.apps import AppConfig

# Labels the staff audit page shows for the support actions (the page falls back to the action key without them).
AUDIT_LABELS = {
    "support.ticket.status": "Changed the status of a support request",
    "support.ticket.priority": "Changed the priority of a support request",
    "support.ticket.category": "Changed the category of a support request",
    "support.ticket.assigned_to": "Assigned a support request",
    "support.ticket.spam": "Marked a support request as spam",
    "support.ticket.reply": "Replied to a support request",
    "support.ticket.note": "Added an internal note to a support request",
    "support.ticket.merge": "Merged support requests",
    "support.bulk.assign": "Assigned several support requests",
    "support.bulk.status": "Changed the status of several support requests",
    "support.bulk.priority": "Changed the priority of several support requests",
    "support.chat.start": "Started a chat from a support request",
    "support.chat.accept": "Accepted a live chat",
    "support.chat.transfer": "Passed a live chat to a colleague",
    "support.chat.convert": "Turned a live chat into a support request",
    "support.chat.end": "Ended a live chat",
    "support.settings": "Changed the support settings",
    "support.canned.create": "Added a saved reply",
    "support.canned.update": "Changed a saved reply",
    "support.canned.delete": "Deleted a saved reply",
    "support.ban": "Blocked a support visitor",
    "support.unban": "Unblocked a support visitor",
    "support.export": "Exported support requests",
}


class SupportConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "support"

    def ready(self):
        from staff import views

        views.AUDIT_ACTIONS.update(AUDIT_LABELS)
