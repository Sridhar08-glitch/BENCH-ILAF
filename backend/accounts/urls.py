from django.urls import path

from . import google_views, views

urlpatterns = [
    path("auth/register", views.RegisterView.as_view()),
    path("auth/login", views.LoginView.as_view()),
    path("auth/refresh", views.RefreshView.as_view()),
    path("auth/logout", views.LogoutView.as_view()),
    path("auth/logout-all", views.LogoutEverywhereView.as_view()),
    path("auth/me", views.MeView.as_view()),
    path("auth/forgot", views.ForgotPasswordView.as_view()),
    path("auth/reset", views.ResetPasswordView.as_view()),
    path("auth/change-password", views.ChangePasswordView.as_view()),
    path("auth/set-password", google_views.SetPasswordView.as_view()),
    path("auth/google", google_views.GoogleLoginView.as_view()),
    path("auth/google/link", google_views.GoogleLinkView.as_view()),
    path("auth/google/unlink", google_views.GoogleUnlinkView.as_view()),
    path("auth/restore", google_views.RestoreAccountView.as_view()),
    path("invites/accept-google", google_views.InviteAcceptGoogleView.as_view()),  # POST {token, credential}
    path("invites/<str:token>/accept-google", google_views.InviteAcceptGoogleView.as_view()),
]
