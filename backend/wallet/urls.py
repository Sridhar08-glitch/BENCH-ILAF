from django.urls import path

from . import views

urlpatterns = [
    path("cards/<uuid:card_id>/wallet/google", views.GoogleWalletView.as_view()),
]
