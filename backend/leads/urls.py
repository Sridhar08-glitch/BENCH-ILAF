from django.urls import path

from . import views, webhook_views

urlpatterns = [
    path("workspaces/<uuid:workspace_id>/leads", views.WorkspaceLeadsView.as_view()),
    path("workspaces/<uuid:workspace_id>/leads.csv", views.LeadsCsvView.as_view()),
    path("workspaces/<uuid:workspace_id>/leads/bulk", views.LeadBulkView.as_view()),
    path("workspaces/<uuid:workspace_id>/lead-assignees", views.LeadAssigneesView.as_view()),
    path("workspaces/<uuid:workspace_id>/lead-settings", views.LeadSettingsView.as_view()),
    path("leads/<uuid:lead_id>", views.LeadDetailView.as_view()),
    path("leads/<uuid:lead_id>/notes", views.LeadNotesView.as_view()),
    path("workspaces/<uuid:workspace_id>/webhooks", webhook_views.WebhookListView.as_view()),
    path("workspaces/<uuid:workspace_id>/webhooks/<uuid:endpoint_id>", webhook_views.WebhookDetailView.as_view()),
    path("workspaces/<uuid:workspace_id>/webhooks/<uuid:endpoint_id>/test", webhook_views.WebhookTestView.as_view()),
    path("workspaces/<uuid:workspace_id>/webhooks/<uuid:endpoint_id>/secret", webhook_views.WebhookSecretView.as_view()),
    path("workspaces/<uuid:workspace_id>/webhooks/<uuid:endpoint_id>/deliveries", webhook_views.WebhookDeliveriesView.as_view()),
    path(
        "workspaces/<uuid:workspace_id>/webhooks/<uuid:endpoint_id>/deliveries/<uuid:delivery_id>",
        webhook_views.WebhookDeliveryView.as_view(),
    ),
]
