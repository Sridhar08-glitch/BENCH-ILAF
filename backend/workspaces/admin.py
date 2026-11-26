from django.contrib import admin, messages

from billing.services import grant_period

from .models import CustomDomain, Member, Workspace


class MemberInline(admin.TabularInline):
    model = Member
    extra = 0
    fields = ("email", "full_name", "role", "status", "user")
    readonly_fields = ("user",)


@admin.action(description="Grant one free period of the default plan")
def grant_default_plan(modeladmin, request, queryset):
    for workspace in queryset:
        try:
            grant_period(workspace)
        except ValueError as exc:
            messages.error(request, f"{workspace.name}: {exc}")
    messages.success(request, "Granted.")


@admin.register(Workspace)
class WorkspaceAdmin(admin.ModelAdmin):
    list_display = ("name", "kind", "created_by", "created_at")
    list_filter = ("kind",)
    search_fields = ("name", "created_by__email")
    inlines = [MemberInline]
    actions = [grant_default_plan]


@admin.register(CustomDomain)
class CustomDomainAdmin(admin.ModelAdmin):
    list_display = ("domain", "status", "workspace", "verified_at", "last_checked_at", "last_error")
    list_filter = ("status",)
    search_fields = ("domain", "workspace__name")
    readonly_fields = ("token", "workspace", "created_by", "created_at")
