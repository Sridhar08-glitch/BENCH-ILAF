from django.urls import path

from . import alerts
from . import staff_views as s
from . import views as v

urlpatterns = [
    # customer
    path("support/summary", v.SummaryView.as_view()),
    path("support/tickets", v.TicketsView.as_view()),
    path("support/tickets/<uuid:ticket_id>", v.TicketDetailView.as_view()),
    path("support/tickets/<uuid:ticket_id>/seen", v.SeenView.as_view()),
    path("support/tickets/<uuid:ticket_id>/messages", v.MessagesView.as_view()),
    path("support/tickets/<uuid:ticket_id>/solve", v.SolveView.as_view()),
    path("support/tickets/<uuid:ticket_id>/reopen", v.ReopenView.as_view()),
    path("support/tickets/<uuid:ticket_id>/rating", v.RatingView.as_view()),
    path("support/tickets/<uuid:ticket_id>/files/<uuid:file_id>/download", v.AttachmentDownloadView.as_view()),
    # public
    path("support/challenge", v.ChallengeView.as_view()),
    path("support/contact", v.ContactView.as_view()),
    path("support/inbound-email/", v.InboundEmailView.as_view()),
    # live chat for visitors
    path("support/chat/status", v.ChatStatusView.as_view()),
    path("support/chat/start", v.ChatStartView.as_view()),
    path("support/chat/<uuid:chat_id>/messages", v.ChatMessagesView.as_view()),
    path("support/chat/<uuid:chat_id>/typing", v.ChatTypingView.as_view()),
    path("support/chat/<uuid:chat_id>/end", v.ChatEndView.as_view()),
    path("support/chat/<uuid:chat_id>/files/<uuid:file_id>/download", v.ChatAttachmentView.as_view()),
    # staff
    path("staff/support/alerts", alerts.AlertsView.as_view()),
    path("staff/support/tickets", s.TicketsView.as_view()),
    path("staff/support/tickets.csv", s.TicketsCsvView.as_view()),
    path("staff/support/tickets/bulk", s.BulkView.as_view()),
    path("staff/support/tickets/<uuid:ticket_id>", s.TicketDetailView.as_view()),
    path("staff/support/tickets/<uuid:ticket_id>/reply", s.ReplyView.as_view()),
    path("staff/support/tickets/<uuid:ticket_id>/merge", s.MergeView.as_view()),
    path("staff/support/tickets/<uuid:ticket_id>/start-chat", s.StartChatView.as_view()),
    path("staff/support/tickets/<uuid:ticket_id>/files/<uuid:file_id>/download", s.AttachmentDownloadView.as_view()),
    path("staff/support/agents", s.AgentsView.as_view()),
    path("staff/support/canned", s.CannedView.as_view()),
    path("staff/support/canned/<int:canned_id>", s.CannedOneView.as_view()),
    path("staff/support/chats", s.ChatsView.as_view()),
    path("staff/support/chats/<uuid:chat_id>", s.ChatDetailView.as_view()),
    path("staff/support/chats/<uuid:chat_id>/accept", s.ChatAcceptView.as_view()),
    path("staff/support/chats/<uuid:chat_id>/messages", s.ChatMessagesView.as_view()),
    path("staff/support/chats/<uuid:chat_id>/typing", s.ChatTypingView.as_view()),
    path("staff/support/chats/<uuid:chat_id>/transfer", s.ChatTransferView.as_view()),
    path("staff/support/chats/<uuid:chat_id>/end", s.ChatEndView.as_view()),
    path("staff/support/chats/<uuid:chat_id>/convert", s.ChatConvertView.as_view()),
    path("staff/support/chats/<uuid:chat_id>/files/<uuid:file_id>/download", s.ChatAttachmentView.as_view()),
    path("staff/support/presence", s.PresenceView.as_view()),
    path("staff/support/presence/heartbeat", s.HeartbeatView.as_view()),
    path("staff/support/bans", s.BansView.as_view()),
    path("staff/support/bans/<int:ban_id>", s.BanOneView.as_view()),
    path("staff/support/metrics", s.MetricsView.as_view()),
    path("staff/support/settings", s.SettingsView.as_view()),
]
