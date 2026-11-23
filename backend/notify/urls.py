from django.urls import path

from . import views

urlpatterns = [
    path("notifications/prefs", views.PrefsView.as_view()),
    path("notifications/push/subscribe", views.PushSubscribeView.as_view()),
    path("notifications/push/unsubscribe", views.PushUnsubscribeView.as_view()),
    path("notifications/push/test", views.PushTestView.as_view()),
    path("notifications/unsubscribe", views.UnsubscribeView.as_view()),
]
