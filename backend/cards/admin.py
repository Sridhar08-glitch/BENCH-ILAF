from django.contrib import admin

from .models import Card, CardItem, SlugHistory


class CardItemInline(admin.TabularInline):
    model = CardItem
    extra = 0


@admin.register(Card)
class CardAdmin(admin.ModelAdmin):
    list_display = ("name", "workspace", "status", "slug", "public_code", "created_at")
    list_filter = ("status",)
    search_fields = ("name", "slug", "public_code", "workspace__name")
    readonly_fields = ("public_code",)
    inlines = [CardItemInline]


admin.site.register(SlugHistory)
