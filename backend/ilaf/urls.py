from django.conf import settings
from django.contrib import admin
from django.urls import include, path
from django.views.static import serve
from django.urls import re_path

admin.site.site_header = f"{settings.PRODUCT_NAME} admin"
admin.site.site_title = f"{settings.PRODUCT_NAME} admin"
admin.site.index_title = f"{settings.COMPANY_NAME}"

from .health import health

urlpatterns = [
    path("health/", health),
    path("health", health),
    path("admin/", admin.site.urls),
    path("api/v1/", include("accounts.urls")),
    path("api/v1/", include("workspaces.urls")),
    path("api/v1/", include("billing.urls")),
    path("api/v1/", include("cards.urls")),
    path("api/v1/", include("leads.urls")),
    path("api/v1/", include("analytics.urls")),
    path("api/v1/", include("operations.urls")),
    path("api/v1/", include("public.urls")),
    path("api/v1/", include("privacy.urls")),
    path("api/v1/", include("wallet.urls")),
    path("api/v1/", include("staff.urls")),
    path("api/v1/", include("designs.urls")),
    path("api/v1/", include("publicapi.urls")),
    path("api/v1/", include("crm.urls")),
    path("api/public/v1/", include("publicapi.public_urls")),
    path("api/v1/", include("guide.urls")),
    path("api/v1/", include("support.urls")),
    path("api/v1/", include("security.urls")),
    path("api/v1/", include("notify.urls")),
]

if settings.DEBUG:
    # In development uploaded files are served by Django. In production the web server or the bucket serves them.
    urlpatterns += [re_path(r"^media/(?P<path>.*)$", serve, {"document_root": settings.MEDIA_ROOT})]

handler404 = "ilaf.errors.json_404"
handler500 = "ilaf.errors.json_500"
