from django.urls import path

from . import views

urlpatterns = [
    path("workspaces/<uuid:workspace_id>/audit", views.AuditView.as_view()),
    path("workspaces/<uuid:workspace_id>/audit.csv", views.AuditCsvView.as_view()),
    path("workspaces/<uuid:workspace_id>/departments", views.DepartmentsView.as_view()),
    path("workspaces/<uuid:workspace_id>/departments/<uuid:department_id>", views.DepartmentDetailView.as_view()),
    path("workspaces/<uuid:workspace_id>/departments/<uuid:department_id>/assign", views.DepartmentAssignView.as_view()),
    path("workspaces/<uuid:workspace_id>/field-rules", views.FieldRulesView.as_view()),
    path("workspaces/<uuid:workspace_id>/change-requests", views.ChangeRequestsView.as_view()),
    path("workspaces/<uuid:workspace_id>/change-requests/bulk", views.ChangeBulkView.as_view()),
    path("workspaces/<uuid:workspace_id>/change-requests/<uuid:change_id>/approve", views.ChangeApproveView.as_view()),
    path("workspaces/<uuid:workspace_id>/change-requests/<uuid:change_id>/reject", views.ChangeRejectView.as_view()),
    path("change-requests/<uuid:change_id>/withdraw", views.ChangeWithdrawView.as_view()),
    path("cards/<uuid:card_id>/reassign", views.ReassignCardView.as_view()),
    path("workspaces/<uuid:workspace_id>/bulk/members", views.BulkMembersView.as_view()),
    path("workspaces/<uuid:workspace_id>/bulk/cards", views.BulkCardsView.as_view()),
    path("public/directory/<str:slug>", views.PublicDirectoryView.as_view()),
]
