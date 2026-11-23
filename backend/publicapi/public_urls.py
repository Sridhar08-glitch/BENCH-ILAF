"""Routes under /api/public/v1/ (authenticated with an API key)."""
from django.urls import path
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from ilaf.throttles import PublicReadThrottle
from ilaf.utils import absolute_url

from . import spec, views


class OpenApiView(APIView):
    """The OpenAPI 3.1 document. Public: it describes the API, it holds no company data."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [PublicReadThrottle]

    def get(self, request):
        response = Response(spec.build(absolute_url(request, "/api/public/v1")))
        response["Cache-Control"] = "public, max-age=300"
        return response


urlpatterns = [
    path("openapi.json", OpenApiView.as_view()),
    path("me", views.MeView.as_view()),
    path("cards", views.CardsView.as_view()),
    path("cards/<uuid:card_id>", views.CardDetailView.as_view()),
    path("cards/<uuid:card_id>/publish", views.CardPublishView.as_view()),
    path("cards/<uuid:card_id>/unpublish", views.CardUnpublishView.as_view()),
    path("members", views.MembersView.as_view()),
    path("members/<uuid:member_id>", views.MemberDetailView.as_view()),
    path("members/<uuid:member_id>/suspend", views.MemberSuspendView.as_view()),
    path("members/<uuid:member_id>/restore", views.MemberRestoreView.as_view()),
    path("invites", views.InvitesView.as_view()),
    path("leads", views.LeadsView.as_view()),
    path("leads/<uuid:lead_id>", views.LeadDetailView.as_view()),
    path("analytics/summary", views.AnalyticsSummaryView.as_view()),
    path("analytics/cards", views.AnalyticsCardsView.as_view()),
    path("analytics/cards/<uuid:card_id>", views.AnalyticsCardView.as_view()),
]
