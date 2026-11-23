from django.urls import path

from . import views

urlpatterns = [
    path("workspaces/<uuid:workspace_id>/cards", views.WorkspaceCardsView.as_view()),
    path("workspaces/<uuid:workspace_id>/cards/reorder", views.ReorderCardsView.as_view()),
    path("cards/<uuid:card_id>/make-default", views.MakeDefaultView.as_view()),
    path("cards/<uuid:card_id>", views.CardDetailView.as_view()),
    path("cards/<uuid:card_id>/photo", views.CardPhotoView.as_view()),
    path("cards/<uuid:card_id>/cover", views.CardCoverView.as_view()),
    path("cards/<uuid:card_id>/icon", views.CardIconView.as_view()),
    path("cards/<uuid:card_id>/file", views.CardFileView.as_view()),
    path("cards/<uuid:card_id>/publish", views.PublishView.as_view()),
    path("cards/<uuid:card_id>/unpublish", views.UnpublishView.as_view()),
    path("cards/<uuid:card_id>/suspend", views.SuspendView.as_view()),
    path("cards/<uuid:card_id>/restore", views.RestoreView.as_view()),
    path("cards/<uuid:card_id>/duplicate", views.DuplicateView.as_view()),
    path("slugs/check", views.SlugCheckView.as_view()),
    path("tools/resolve-link", views.ResolveLinkView.as_view()),
]
