"""Routes of the web app (normal sign-in) for managing API keys."""
from django.urls import path

from . import manage_views

urlpatterns = [
    path("workspaces/<uuid:workspace_id>/api-keys", manage_views.ApiKeysView.as_view()),
    path("workspaces/<uuid:workspace_id>/api-keys/<uuid:key_id>/revoke", manage_views.ApiKeyRevokeView.as_view()),
    path("workspaces/<uuid:workspace_id>/api-keys/<uuid:key_id>/rotate", manage_views.ApiKeyRotateView.as_view()),
]
