from django.urls import path

from . import views

urlpatterns = [
    path("public/cards/<str:key>", views.PublicCardView.as_view()),
    path("public/cards/<str:key>/events", views.PublicEventView.as_view()),
    path("public/cards/<str:key>/leads", views.PublicLeadView.as_view()),
    path("public/cards/<str:key>/vcard", views.PublicVcardView.as_view()),
    path("public/cards/<str:key>/qr.svg", views.PublicQrView.as_view()),
    path("public/cards/<str:key>/qr.png", views.PublicQrPngView.as_view()),
    path("public/cards/<str:key>/meeting-requests", views.PublicMeetingRequestView.as_view()),
]
