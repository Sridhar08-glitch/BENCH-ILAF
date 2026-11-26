from django.contrib import admin

from .models import Order


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = ("number", "workspace", "card_name", "customer_name", "total", "currency", "status", "payment_status", "created_at")
    list_filter = ("status", "payment_status", "payment_method")
    search_fields = ("number", "customer_name", "customer_phone", "customer_email", "card_name")
    readonly_fields = ("number", "items", "created_at", "updated_at")
