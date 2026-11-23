from django.urls import path

from . import views

urlpatterns = [
    path("privacy/requests", views.RequestsView.as_view()),
    path("privacy/export", views.ExportView.as_view()),
    path("privacy/requests/<uuid:request_id>/download-link", views.DownloadLinkView.as_view()),
    path("privacy/download/check", views.DownloadCheckView.as_view()),  # POST {token}: the token stays out of the URL
    path("privacy/download", views.DownloadView.as_view()),  # POST {token}
    path("privacy/download/<str:token>/check", views.DownloadCheckView.as_view()),
    path("privacy/download/<str:token>", views.DownloadView.as_view()),
    path("privacy/delete-account", views.DeleteAccountView.as_view()),
    path("privacy/workspaces/<uuid:workspace_id>/delete", views.DeleteCompanyView.as_view()),
    path("privacy/workspaces/<uuid:workspace_id>/restore", views.RestoreCompanyView.as_view()),
]
