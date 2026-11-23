from django.contrib import admin

from .models import DataRequest


@admin.register(DataRequest)
class DataRequestAdmin(admin.ModelAdmin):
    list_display = ("kind", "scope", "status", "user", "requested_at", "due_at", "completed_at", "handled_by")
    list_filter = ("kind", "scope", "status")
    search_fields = ("user__email", "workspace__name")
    readonly_fields = ("requested_at", "file_name", "file_size", "details")
    actions = ["mark_handled"]

    @admin.action(description="Mark as handled by me")
    def mark_handled(self, request, queryset):
        queryset.update(handled_by=request.user)
