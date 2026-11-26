from django.urls import path

from . import views_commerce as views

urlpatterns = [
    path("cards/<uuid:card_id>/products", views.ProductsView.as_view()),
    path("cards/<uuid:card_id>/products/<uuid:product_id>", views.ProductDetailView.as_view()),
    path("cards/<uuid:card_id>/products/<uuid:product_id>/image", views.ProductImageView.as_view()),
    path("cards/<uuid:card_id>/booking-settings", views.BookingSettingsView.as_view()),
]
