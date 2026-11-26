"""Counts for the in-app bell: orders and bookings that arrived after the person last looked.

The bell itself lives in leads/bell_views.py and uses the same last-seen marker for contacts, orders and bookings,
so one tap on the bell clears all three."""
from workspaces.access import commerce_bookings, commerce_orders

from .models import Order


def alert_counts(member, since):
    """{"orders": n, "bookings": n} newer than `since` that this member may see: those of their own cards (and, for an owner or
    admin, of the company card)."""
    orders = commerce_orders(member).filter(created_at__gt=since)
    bookings = commerce_bookings(member).filter(created_at__gt=since)
    return {"orders": orders.count(), "bookings": bookings.count()}
