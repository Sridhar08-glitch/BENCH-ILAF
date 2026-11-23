from django.urls import path

from . import views

urlpatterns = [
    path("auth/login/mfa", views.LoginMfaView.as_view()),
    path("auth/2fa", views.TwoFactorStatusView.as_view()),
    path("auth/2fa/setup", views.TwoFactorSetupView.as_view()),
    path("auth/2fa/confirm", views.TwoFactorConfirmView.as_view()),
    path("auth/2fa/recovery-codes", views.RecoveryCodesView.as_view()),
    path("auth/2fa/disable", views.TwoFactorDisableView.as_view()),
    path("auth/devices", views.DevicesView.as_view()),
    path("auth/devices/sign-out-others", views.SignOutOthersView.as_view()),
    path("auth/devices/<uuid:session_id>", views.DeviceDetailView.as_view()),
    path("auth/trusted-devices/<uuid:device_id>", views.TrustedDeviceDetailView.as_view()),
]

from . import company_views  # noqa: E402

urlpatterns += [
    path("workspaces/<uuid:workspace_id>/domains", company_views.DomainsView.as_view()),
    path("workspaces/<uuid:workspace_id>/domains/<uuid:domain_id>", company_views.DomainDetailView.as_view()),
    path("workspaces/<uuid:workspace_id>/domains/<uuid:domain_id>/verify", company_views.DomainVerifyView.as_view()),
    path("domains/confirm", company_views.DomainConfirmView.as_view()),
    path("workspaces/<uuid:workspace_id>/email-settings", company_views.EmailSettingsView.as_view()),
    path("workspaces/<uuid:workspace_id>/email-preview", company_views.EmailPreviewView.as_view()),
]
