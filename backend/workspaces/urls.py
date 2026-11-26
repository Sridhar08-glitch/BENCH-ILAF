from django.urls import path

from . import views, views_domains

urlpatterns = [
    path("me/workspaces", views.MyWorkspacesView.as_view()),
    path("workspaces", views.WorkspacesView.as_view()),
    path("workspaces/<uuid:workspace_id>", views.WorkspaceDetailView.as_view()),
    path("workspaces/<uuid:workspace_id>/domain", views_domains.DomainView.as_view()),
    path("workspaces/<uuid:workspace_id>/domain/check", views_domains.DomainCheckView.as_view()),
    path("domains/resolve", views_domains.DomainResolveView.as_view()),
    path("domains/allowed", views_domains.DomainAllowedView.as_view()),
    path("workspaces/<uuid:workspace_id>/logo", views.LogoView.as_view()),
    path("workspaces/<uuid:workspace_id>/symbol", views.SymbolView.as_view()),
    path("workspaces/<uuid:workspace_id>/background", views.BackgroundView.as_view()),
    path("workspaces/<uuid:workspace_id>/template-front", views.TemplateFrontView.as_view()),
    path("workspaces/<uuid:workspace_id>/template-back", views.TemplateBackView.as_view()),
    path("workspaces/<uuid:workspace_id>/me", views.MyMembershipView.as_view()),
    path("workspaces/<uuid:workspace_id>/members", views.MembersView.as_view()),
    path("workspaces/<uuid:workspace_id>/members/import", views.MembersImportView.as_view()),
    path("workspaces/<uuid:workspace_id>/members/<uuid:member_id>", views.MemberDetailView.as_view()),
    path("workspaces/<uuid:workspace_id>/members/<uuid:member_id>/resend-invite", views.ResendInviteView.as_view()),
    path("workspaces/<uuid:workspace_id>/invites", views.InvitesView.as_view()),
    path("invites/lookup", views.InviteLookupView.as_view()),  # POST {token}: the token stays out of the URL
    path("invites/accept", views.InviteAcceptView.as_view()),  # POST {token, password, full_name}
    path("invites/<str:token>", views.InviteLookupView.as_view()),
    path("invites/<str:token>/accept", views.InviteAcceptView.as_view()),
]
