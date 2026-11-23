from django.urls import path

from . import report_views, views

urlpatterns = [
    path("workspaces/<uuid:workspace_id>/analytics", views.AnalyticsView.as_view()),
    path("workspaces/<uuid:workspace_id>/analytics/people", views.PeopleView.as_view()),
    path("workspaces/<uuid:workspace_id>/analytics/departments", views.DepartmentsView.as_view()),
    path("workspaces/<uuid:workspace_id>/analytics/links", views.LinksView.as_view()),
    path("workspaces/<uuid:workspace_id>/analytics/sources", views.SourcesView.as_view()),
    path("workspaces/<uuid:workspace_id>/report-preferences", report_views.PreferencesView.as_view()),
    path("workspaces/<uuid:workspace_id>/reports/weekly/preview", report_views.PreviewView.as_view()),
    path("reports/unsubscribe", report_views.UnsubscribeView.as_view()),
]
