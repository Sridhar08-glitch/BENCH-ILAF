from django.urls import path

from . import views

urlpatterns = [
    path("workspaces/<uuid:workspace_id>/crm", views.CrmOverviewView.as_view()),
    path("workspaces/<uuid:workspace_id>/crm/<str:vendor_key>", views.CrmConnectionView.as_view()),
    path("workspaces/<uuid:workspace_id>/crm/<str:vendor_key>/connect", views.CrmConnectView.as_view()),
    path("workspaces/<uuid:workspace_id>/crm/<str:vendor_key>/disconnect", views.CrmDisconnectView.as_view()),
    path("workspaces/<uuid:workspace_id>/crm/<str:vendor_key>/test", views.CrmTestView.as_view()),
    path("workspaces/<uuid:workspace_id>/crm/<str:vendor_key>/backfill", views.CrmBackfillView.as_view()),
    path("workspaces/<uuid:workspace_id>/crm/<str:vendor_key>/jobs", views.CrmJobsView.as_view()),
    path("crm/callback/<str:vendor_key>", views.CrmCallbackView.as_view()),
]
