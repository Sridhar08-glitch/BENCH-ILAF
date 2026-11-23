from django.urls import path

from . import views

urlpatterns = [
    path("guide/progress", views.ProgressView.as_view()),
]
