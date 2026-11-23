from django.urls import path

from . import views

urlpatterns = [
    path("plans", views.PlansView.as_view()),
    path("workspaces/<uuid:workspace_id>/checkout", views.CheckoutView.as_view()),
    path("workspaces/<uuid:workspace_id>/subscription", views.SubscriptionView.as_view()),
    path("workspaces/<uuid:workspace_id>/invoices", views.InvoicesView.as_view()),
    path("stripe/webhook", views.StripeWebhookView.as_view()),
]
