"""The one table of who may do what in the staff area.

The staff views take their allowed roles from `roles_for(permission)`, and the permissions page of the staff area is
generated from the same table, so the page can never say something the server does not enforce.
Roles: read_only (looks only), support (looks, opens support view, handles single cards, data requests, abuse reports and
design requests), admin (everything).
"""
ROLE_ORDER = ("admin", "support", "read_only")

# key -> (what it allows, group, roles that have it)
PERMISSIONS = {
    "view": ("Look at companies, cards, leads, reports and logs", "Look", ("admin", "support", "read_only")),
    "search": ("Use global search", "Look", ("admin", "support", "read_only")),
    "support": ("Open a support view (read-only mirror of a company)", "Support", ("admin", "support")),
    "suspendCard": ("Suspend or restore a single card", "Safety", ("admin", "support")),
    "triage": ("Handle abuse reports: dismiss, warn the owner, add notes", "Safety", ("admin", "support")),
    "data": ("Handle data requests: start export, confirm delete, mark done", "Safety", ("admin", "support")),
    "notes": ("Write internal notes, assign applications and requests", "Work", ("admin", "support")),
    "resend": ("Resend failed emails", "Work", ("admin", "support")),
    "export": ("Download CSV files (analytics, audit log)", "Work", ("admin", "support")),
    "suspendCo": ("Suspend or restore a whole company", "Admin only", ("admin",)),
    "announce": ("Send announcements and emails to customers", "Admin only", ("admin",)),
    "flags": ("Change feature switches and rollouts", "Admin only", ("admin",)),
    "plans": ("Grant or change plan labels", "Admin only", ("admin",)),
    "staff": ("Invite, change or remove staff, revoke sessions", "Admin only", ("admin",)),
    "signOutUser": ("Force a customer to sign out everywhere", "Admin only", ("admin",)),
}

ROLE_SUMMARY = {
    "admin": "Everything, including staff, plans and feature switches.",
    "support": "Looks at everything, opens support view, suspends a single card, handles data requests and abuse reports. "
               "Cannot change plans, staff or feature switches.",
    "read_only": "Looks only. Changes nothing, cannot open support view, cannot download CSV files.",
}


def roles_for(permission):
    return PERMISSIONS[permission][2]


def can(role, permission):
    return role in PERMISSIONS[permission][2]


def matrix():
    """The permissions page: one row per permission with the roles that have it."""
    return {
        "roles": [{"key": r, "summary": ROLE_SUMMARY[r]} for r in ROLE_ORDER],
        "permissions": [
            {"key": key, "label": label, "group": group, "roles": list(roles)}
            for key, (label, group, roles) in PERMISSIONS.items()
        ],
    }
