from django.contrib import admin, messages

from .models import Payment, Plan, Subscription
from .services import grant_period


@admin.register(Plan)
class PlanAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "kind", "interval", "price_minor", "currency", "max_cards", "per_seat", "active")
    list_editable = ("price_minor", "active")


@admin.action(description="Grant one more period of the current plan (no payment)")
def extend_one_period(modeladmin, request, queryset):
    for sub in queryset:
        grant_period(sub.workspace, plan=sub.plan, seats=sub.seats_total)
    messages.success(request, f"Extended {queryset.count()} subscription(s).")


@admin.register(Subscription)
class SubscriptionAdmin(admin.ModelAdmin):
    list_display = ("workspace", "plan", "status", "seats_total", "starts_at", "ends_at")
    list_filter = ("status", "plan")
    search_fields = ("workspace__name",)
    actions = [extend_one_period]


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = ("number", "workspace", "plan", "amount_minor", "currency", "source", "paid_at")
    list_filter = ("source", "plan")
    search_fields = ("number", "workspace__name", "stripe_session_id")
    readonly_fields = [f.name for f in Payment._meta.fields]
