from django.urls import path

from . import views

urlpatterns = [
    path("workspaces/<uuid:workspace_id>/design-requests", views.RequestsView.as_view()),
    path("workspaces/<uuid:workspace_id>/design-requests/summary", views.SummaryView.as_view()),
    path("workspaces/<uuid:workspace_id>/design-requests/<uuid:request_id>", views.RequestDetailView.as_view()),
    path("workspaces/<uuid:workspace_id>/design-requests/<uuid:request_id>/seen", views.SeenView.as_view()),
    path("workspaces/<uuid:workspace_id>/design-requests/<uuid:request_id>/messages", views.MessagesView.as_view()),
    path("workspaces/<uuid:workspace_id>/design-requests/<uuid:request_id>/files", views.FilesView.as_view()),
    path("workspaces/<uuid:workspace_id>/design-requests/<uuid:request_id>/files/<uuid:file_id>/download", views.FileDownloadView.as_view()),
    path("workspaces/<uuid:workspace_id>/design-requests/<uuid:request_id>/withdraw", views.WithdrawView.as_view()),
    path("workspaces/<uuid:workspace_id>/design-requests/<uuid:request_id>/approve", views.ApproveView.as_view()),
    path("workspaces/<uuid:workspace_id>/design-requests/<uuid:request_id>/request-changes", views.RequestChangesView.as_view()),
    path("workspaces/<uuid:workspace_id>/design-requests/<uuid:request_id>/preview", views.RequestPreviewView.as_view()),
    path("workspaces/<uuid:workspace_id>/custom-faces", views.CustomFacesView.as_view()),
    path("public/custom-previews/<str:token>", views.PublicPreviewView.as_view()),
]
