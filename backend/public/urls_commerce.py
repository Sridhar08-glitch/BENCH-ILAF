from django.urls import path

from . import views_commerce as views

urlpatterns = [
    path("public/cards/<str:key>/products", views.PublicProductsView.as_view()),
    path("public/cards/<str:key>/orders", views.PublicOrderView.as_view()),
    path("public/orders/<str:number>", views.PublicOrderStatusView.as_view()),
    path("public/cards/<str:key>/booking", views.PublicBookingInfoView.as_view()),
    path("public/cards/<str:key>/availability", views.PublicAvailabilityView.as_view()),
    path("public/cards/<str:key>/bookings", views.PublicBookingView.as_view()),
    path("public/bookings/<uuid:booking_id>/cancel", views.PublicBookingCancelView.as_view()),
]
