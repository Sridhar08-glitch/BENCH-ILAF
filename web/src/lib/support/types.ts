// Shapes of the support API (see "Support" in API_CONTRACT.md).

export const CATEGORIES = ["account", "billing", "cards_design", "team_company", "bug", "feature_request", "privacy_data", "other"] as const;
export type Category = (typeof CATEGORIES)[number];
export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const STATUSES = ["new", "open", "waiting_customer", "solved", "closed"] as const;
export type TicketStatus = (typeof STATUSES)[number];
export type Channel = "form" | "chat" | "email";
export type SlaState = "ok" | "at_risk" | "breached" | "paused" | "done";

/** What the page tells support about itself. Never secrets: see context.ts. */
export interface SupportContext {
  page_url?: string;
  route?: string;
  app_language?: string;
  build_id?: string;
  card_id?: string;
  screen?: { w: number; h: number };
  workspace_id?: string;
  // filled in by the server
  browser?: string;
  os?: string;
  role?: string;
  plan_label?: string;
}

export interface SupportFile { id: string; name: string; content_type: string; size: number; by: string; message_id: string | null; created_at: string }
export interface SupportMessage {
  id: string; author: "customer" | "staff" | "system"; author_name: string; kind: "message" | "status" | "transcript"; body: string;
  via: "web" | "email" | "chat"; status_to: string; created_at: string; files: SupportFile[]; internal?: boolean;
}

export interface TicketSummary {
  id: string; number: number; label: string; subject: string; category: Category; status: TicketStatus; channel: Channel;
  created_at: string; updated_at: string; last_message_at: string | null; last_author: string; solved_at: string | null; rating: number | null;
  workspace_id: string | null; unread: number; can_reopen: boolean;
}
export interface TicketDetail extends TicketSummary {
  messages: SupportMessage[]; context: SupportContext; rating_comment: string; active_chat_id: string | null; reopen_until: string | null;
}

/** `live` (same as `online`) is what the server will do with a new chat: true means a live chat, false means the message becomes a ticket. */
export type ChatReason = "online" | "switched_off" | "closed" | "nobody_online";
export interface ChatStatus { enabled: boolean; online: boolean; live?: boolean; reason?: ChatReason; in_business_hours: boolean; accept_seconds: number; signed_in: boolean; open_chat_id?: string }
export type ChatState = "waiting" | "active" | "ended" | "offline_converted";
export interface ChatMessage { id: number; author: "customer" | "staff" | "system"; author_name: string; body: string; created_at: string; delivery: string; files: SupportFile[] }
export interface ChatPoll { messages: ChatMessage[]; status: ChatState; typing: boolean; read_id: number; staff_name: string; ticket?: string | null; ticket_id?: string }
export interface ChatStarted { id: string; status: ChatState; token?: string; ticket?: string; auto_reply?: string; converted_to_ticket?: boolean; reason?: ChatReason }

// ---------------------------------------------------------------- staff
export interface StaffTicketRow {
  id: string; number: number; label: string; subject: string; category: Category; status: TicketStatus; channel: Channel; priority: Priority;
  requester_email: string; requester_name: string; requester_id: string | null; language: string; assigned_to: string | null; assigned_name: string;
  workspace_id: string | null; workspace_name: string; sla: SlaState; first_due_at: string | null; resolve_due_at: string | null;
  first_response_at: string | null; created_at: string; last_message_at: string | null; last_author: string; rating: number | null; spam: boolean; merged_into: string | null;
}
export interface StaffAgent { id: string; name: string; email: string; role: string }
export interface StaffInbox {
  count: number; page: number; pages: number; page_size: number; results: StaffTicketRow[];
  counts: { mine: number; unassigned: number; open: number }; agents: StaffAgent[];
}
export interface CustomerPanel {
  email: string; name: string; signed_in: boolean; ticket_count: number; user_id?: string; full_name?: string; email_verified?: boolean; language?: string;
  created_at?: string; last_sign_in?: string | null; workspace?: { id: string; name: string; plan: string; plan_status: string };
  support_view: { available: boolean }; recent_errors: string[];
}
export interface StaffTicketDetail extends StaffTicketRow {
  messages: SupportMessage[]; context: SupportContext; rating_comment: string; active_chat_id: string | null; customer: CustomerPanel; agents: StaffAgent[];
}
export interface StaffChat {
  id: string; status: ChatState; started_at: string; ended_at: string | null; last_activity: string; staff_name: string; visitor: string; visitor_email: string;
  signed_in: boolean; assigned_to: string | null; ticket_id: string | null; ticket: string | null; language: string; context: SupportContext; spam_hits: number;
  last_message: string; ip_hash: string; workspace_id: string | null;
}
export interface Canned { id: number; title: string; body_en: string; body_ar: string; active: boolean }
export interface Metrics {
  days: number; created: number; solved: number; open_now: number; breached_now: number; first_response_seconds: number | null; resolution_seconds: number | null;
  by_category: { category: string; count: number }[]; by_channel: { channel: string; count: number }[]; by_day: { date: string; count: number }[];
  satisfaction: { average: number | null; count: number; distribution: Record<string, number> };
  chats: { total: number; answered: number; converted: number; wait_seconds: number | null };
}
export type DayHours = [string, string][];
export interface SupportSettings {
  timezone: string; business_hours: Record<string, DayHours>; holidays: string[]; chat_enabled: boolean; chat_accept_seconds: number;
  auto_reply_en: string; auto_reply_ar: string; offline_reply_en: string; offline_reply_ar: string; sla: Record<Priority, { first: number; resolve: number }>;
  blocked_words: string[]; inbound_address: string; updated_at: string;
  mail: { reply_to: string; imap_configured: boolean; imap_folder: string; webhook_path: string; webhook_secret_set: boolean; ticket_prefix: string };
}
export interface Presence { status: "online" | "away" | "offline"; capacity: number }
