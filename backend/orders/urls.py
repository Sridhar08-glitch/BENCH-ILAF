from django.urls import path

from workspaces import views_commerce as views

urlpatterns = [
    path("workspaces/<uuid:workspace_id>/commerce-access", views.CommerceAccessView.as_view()),
    path("workspaces/<uuid:workspace_id>/orders", views.OrdersView.as_view()),
    path("workspaces/<uuid:workspace_id>/orders/export", views.OrdersExportView.as_view()),
    path("workspaces/<uuid:workspace_id>/orders/<uuid:order_id>", views.OrderDetailView.as_view()),
    path("workspaces/<uuid:workspace_id>/bookings", views.BookingsView.as_view()),
    path("workspaces/<uuid:workspace_id>/bookings/<uuid:booking_id>", views.BookingDetailView.as_view()),
]
