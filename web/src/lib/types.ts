// Types written by hand from the API contract. Field names match the contract exactly.

/**
 * The numbered design from the design library (see src/lib/library). The colours are not stored: they come
 * from the face and its colourway, so the card, its icons and the area below always match.
 */
export interface Design {
  /** 1 to 400 */
  face: number;
  /** The id of a custom face made for the card's company; it replaces `face` while it is live. null (or missing) means none. */
  custom_face?: number | null;
  /** 0 to 3 pick one of the face's own four colourways; 4 is the company colours (only with a company palette) */
  colour: number;
  /** 0 is the classic face card; 1 to 27 draw a photo header from the page styles in its place (paid plans) */
  top: number;
  /** 1 to 427, how the area below the card is laid out (401 to 427 are the button sets of the page styles) */
  below: number;
  /** 0 to 400, the opening animation (0 = none, 1 = fade-up) */
  intro: number;
  /** "face" keeps each face's own fonts; otherwise one of the font keys of the picker (lib/library/text) used for the name, title and contact lines */
  font: string;
  /** 60 to 150, the size of the name, title and contact lines together, in percent */
  size: number;
  /** true shows the card photo on faces with a photo slot, false shows initials */
  photo: boolean;
  /** each button's mark uses that brand's own colour */
  brand_colors: boolean;
  /** show "Powered by" */
  foot: boolean;
}

export interface VcardOptions {
  company: boolean;
  photo: boolean;
  phones: boolean;
  emails: boolean;
  urls: boolean;
  social: boolean;
  addr: boolean;
  note: string;
}

export type ItemKind =
  | "Mobile" | "Landline" | "WhatsApp" | "Email" | "SMS" | "Location" | "Website"
  | "Facebook" | "Instagram" | "LinkedIn" | "X" | "YouTube" | "TikTok" | "Snapchat"
  | "Telegram" | "Pinterest" | "Threads" | "GitHub" | "Behance" | "Dribbble" | "Discord"
  | "Spotify" | "SoundCloud" | "Twitch" | "Reddit" | "Medium" | "Calendly" | "AppStore"
  | "GooglePlay" | "PayPal" | "Meeting" | "Custom"
  | "Document" | "Menu" | "Vimeo" | "Loom" | "GoogleReview" | "Trustpilot" | "TripAdvisor" | "AppleMaps" | "WhatsAppChannel"
  | "Airbnb" | "Etsy" | "Shopify" | "Amazon" | "DownloadFile";

/** Icon choice for one button. null or "auto" = pick from the kind or the link's domain. */
export interface ItemIcon {
  type: "auto" | "brand" | "lucide" | "upload";
  key: string | null;
  image_url: string | null;
}

export interface CardItem {
  id?: string;
  icon?: ItemIcon | null;
  kind: ItemKind;
  value: string;
  label: string;
  on: boolean;
  order?: number;
}

export type CardStatus = "draft" | "published" | "suspended";

export interface CardStats {
  views: number;
  scans: number;
  saves: number;
  /** The number of contacts. null when the reader may not see this card's contacts (an owner or admin on an employee's card). */
  leads: number | null;
}

export interface Card {
  id: string;
  workspace_id: string;
  owner: { id: string; full_name: string; email: string } | null;
  public_code: string;
  public_url: string;
  slug: string | null;
  status: CardStatus;
  /** A private name for the owner's own list ("Work", "Personal"); never on the public page. */
  label?: string;
  sort_order?: number;
  /** The card "My QR" and event mode open first. */
  is_default?: boolean;
  /** The company's own card (it belongs to the company, not to a person). */
  is_company?: boolean;
  name: string;
  title: string;
  company: string;
  address: string;
  /** A short text about the person (at most 300 characters), shown by the page-style headers. */
  bio?: string;
  photo_url: string | null;
  cover_url?: string | null;
  save_contact: boolean;
  /** Language of the public page: a fixed one, or "auto" (the visitor's own). */
  language?: "en" | "ar" | "auto";
  /** Keeps the card out of the public company directory. */
  hide_from_directory?: boolean;
  /** Search engines may list the public page (default off: the page carries a noindex tag). */
  seo_indexable?: boolean;
  vc: VcardOptions;
  /** Feature settings such as the exchange-contact form. */
  features?: CardFeatures;
  design: Design;
  items: CardItem[];
  created_at: string;
  updated_at: string;
  stats: CardStats;
  /** What the signed-in person may change on this card (company cards). */
  field_access?: FieldAccess;
  /** Changes of this card that wait for an admin. */
  pending_changes?: PendingChange[];
  /** Fields of the last save that were sent for approval instead of being saved. */
  submitted_for_approval?: string[];
}

/** How the exchange form treats one field. */
export type FieldMode = "off" | "optional" | "required";
export interface ExchangeSettings {
  enabled: boolean;
  fields: { email: FieldMode; phone: FieldMode; company: FieldMode; note: FieldMode };
  consent_text: string;
}
export interface CardFeatures {
  exchange: ExchangeSettings;
}
/** What the public page needs to draw the exchange form. */
export interface PublicFeatures {
  exchange: ExchangeSettings & { privacy_url: string | null };
  meeting_form: boolean;
}
/** Company lead handling. */
export interface LeadSettings {
  privacy_url: string;
  notify_admins: boolean;
}

export type CardPatch = Partial<Omit<Card, "id" | "workspace_id" | "owner" | "public_code" | "public_url" | "created_at" | "updated_at" | "stats" | "photo_url" | "cover_url" | "field_access" | "pending_changes" | "submitted_for_approval">>;

export interface User {
  id: string;
  email: string;
  full_name: string;
  photo_url: string | null;
  created_at: string;
  /** Sign-in methods: whether the address is proven, a password is set, and Google is linked. */
  email_verified?: boolean;
  has_password?: boolean;
  google_linked?: boolean;
  google_email?: string | null;
  /** The language the person chose ("en", "ar"); null until they choose one. */
  language?: string | null;
  /** The person agreed to product-update e-mails (announcements). Service e-mails never depend on it. */
  product_updates?: boolean;
  /** 2-step verification: whether it is on, and the company rule that asks for it (with its deadline). */
  two_factor?: TwoFactorSummary;
}

export interface TwoFactorSummary {
  enabled: boolean;
  required: { workspace_id: string; workspace_name: string; deadline: string; enforced: boolean } | null;
}

export type SubscriptionStatus = "none" | "active" | "expired";
export interface Subscription {
  status: SubscriptionStatus;
  plan_code: string | null;
  seats_total: number;
  seats_used: number;
  starts_at: string | null;
  ends_at: string | null;
  grace_ends_at: string | null;
  live: boolean;
  /** Stripe charges again at `renews_at` (the end of the period) until the owner turns it off. */
  auto_renew?: boolean;
  /** The owner switched the renewal off: the period runs to `ends_at` and stops. */
  cancel_at_period_end?: boolean;
  renews_at?: string | null;
  /** The last renewal payment failed: the owner must fix the payment method. */
  payment_failed?: boolean;
  /** A Stripe customer exists: the owner can open the billing portal. */
  can_manage_billing?: boolean;
  /** The company may use the Enterprise-only features (Enterprise plan, or a Company period bought before Enterprise existed). */
  enterprise?: boolean;
  grandfathered?: boolean;
  features?: Partial<Record<EnterpriseFeature, boolean>>;
}

export type CustomDomainStatus = "pending" | "verified" | "failed" | "expired" | "dns_broken";
export interface DnsRecord { type: "TXT" | "CNAME" | "A"; name: string; value: string }
/** A company's custom-domain claim (API_CONTRACT.md, "Custom domains"). */
export interface CustomDomainInfo {
  domain: string;
  status: CustomDomainStatus;
  /** The domain is answering visitors right now (verified or in its grace period, and the plan is Enterprise-live). */
  serving: boolean;
  verified_at: string | null;
  last_checked_at: string | null;
  /** txt_missing, txt_mismatch, cname_missing, cname_wrong, dns_error, domain_taken, dns_released; null when the last check was fine. */
  last_error: string | null;
  last_error_message: string | null;
  expires_at: string | null;
  grace_ends_at: string | null;
  records: { txt: DnsRecord; cname: DnsRecord; a: DnsRecord[]; apex: boolean };
  url: string;
}
export interface DomainCheckResult { ok: boolean; reason: string | null; txt_ok: boolean; routing_ok: boolean; message: string | null }

export type EnterpriseFeature = "departments" | "directory" | "field_rules" | "activity_log" | "integrations" | "custom_domain" | "sign_in_rules";

export type EnterpriseStatus = "requested" | "quoted" | "accepted" | "declined" | "cancelled";
/** A company's request for an Enterprise quote and, once staff answered, the quote (price per seat, per year). */
export interface EnterpriseRequest {
  id: string;
  status: EnterpriseStatus;
  seats_wanted: number;
  message: string;
  phone: string;
  quoted_seats: number | null;
  quoted_price_per_seat_minor: number | null;
  quoted_total_minor: number | null;
  currency: string;
  interval: string;
  staff_note: string;
  seats_used: number;
  created_at: string;
  quoted_at: string | null;
  decided_at: string | null;
}

export type Role = "owner" | "admin" | "employee";

export interface WorkspaceSummary {
  id: string;
  kind: "personal" | "company";
  name: string;
  role: Role;
  card_count: number;
  subscription: Subscription;
}

export type BrandMode = "brand" | "light" | "dark";
export interface BrandColours {
  primary: string;
  accent: string;
  mode: BrandMode;
  /** The owner's own text colour; absent means the text colour is worked out so it is always readable. */
  text?: string;
}
/** The five card colours made from the brand colours, all "#rrggbb". */
export interface BrandPalette {
  bg: string;
  bg2: string;
  fg: string;
  acc: string;
  on: string;
}
export type LogoDisplay = "auto" | "symbol" | "symbol_name" | "full";
export type LogoPlacement = "card" | "above" | "both";
export type LogoCorner = "auto" | "tl" | "tr" | "bl" | "br";
export type LogoChip = "auto" | "always" | "never" | "white" | "black";
/** Where the owner put the logo on one design: left and top, and the width, in percent of the card. */
export interface LogoSpot {
  x: number;
  y: number;
  w: number;
}
/** The places the owner gave the logo, by design: "f12" is card face 12, "t3" is page style 3. */
export type LogoFree = Record<string, LogoSpot>;
export type ArtworkMode = "none" | "background" | "pattern" | "template";
export type TemplateZone = "A" | "B" | "C" | "D";

export interface BrandArtwork {
  mode: ArtworkMode;
  background: { kind: "sample" | "upload" | "none"; sample: string | null; strength: number };
  pattern: { enabled: boolean; size: "s" | "m" | "l"; spacing: "tight" | "normal" | "wide"; angle: 0 | -15 | -30; opacity: number; combine_with_background: boolean };
  template: { kind: "sample" | "upload" | "none"; sample: string | null; zone: TemplateZone; text_colour: string; text_size: "s" | "m" | "l" };
}

/** Everything the company brand adds (all optional: personal workspaces and older brands read the defaults). */
export interface BrandLook {
  colours?: BrandColours | null;
  palette?: BrandPalette | null;
  logo_display?: LogoDisplay;
  logo_placement?: LogoPlacement;
  logo_corner?: LogoCorner;
  logo_chip?: LogoChip;
  show_company_name?: boolean;
  /** The logo's size as a percentage of its automatic size (50 to 150). */
  logo_size?: number;
  logo_free?: LogoFree;
  artwork?: BrandArtwork;
  logo_url?: string | null;
  symbol_url?: string | null;
  background_url?: string | null;
  template_front_url?: string | null;
  template_back_url?: string | null;
}

export interface Brand extends BrandLook {
  company_name: string;
  logo_url: string | null;
  website: string;
  design: Design;
  lock_design: boolean;
  show_footer: boolean;
  /** With the design lock on, departments may still set their own face, colour, layout and opening. */
  lock_allows_departments?: boolean;
  directory_enabled?: boolean;
  directory_slug?: string | null;
}

export interface WorkspaceDetail {
  id: string;
  kind: "personal" | "company";
  name: string;
  /** The country the company chose (ISO 3166-1 alpha-2), or null. */
  country?: string | null;
  role: Role;
  brand: Brand;
  /** The company's own domain once it is VERIFIED, else null. */
  custom_domain: string | null;
  /** The claim with what to add to DNS (owner and admin of a company only). */
  custom_domain_info?: CustomDomainInfo | null;
  subscription: Subscription;
  /** Company sign-in rules (owner and admins of a company only), and the deletion date when one is scheduled. */
  security?: {
    allowed_email_domains: string[];
    require_google_signin: boolean;
    require_2fa?: boolean;
    require_2fa_since?: string | null;
    two_factor_grace_days?: number;
    reply_to_email?: string;
    verified_domains?: string[];
    suggested_email_domains?: string[];
  } | null;
  /** The company's proven e-mail domain (the "Verified company" badge), or null. */
  verified_domain?: string | null;
  deletion_due_at?: string | null;
}

export interface Plan {
  code: string;
  name: string;
  kind: "personal" | "company";
  interval: "year" | "month";
  price_minor: number;
  currency: string;
  max_cards: number;
  per_seat: boolean;
  min_seats: number;
  features: string[];
  /** false for the free trial plan and the retired Business plan: they are never offered for purchase. */
  purchasable?: boolean;
  /** Enterprise: no list price, the company asks for a quote. */
  by_quote?: boolean;
}

export interface Invoice {
  id: string;
  number: string;
  amount_minor: number;
  currency: string;
  plan_code: string;
  paid_at: string;
}

export interface Member {
  id: string;
  user: { id: string; full_name: string; email: string; photo_url: string | null } | null;
  email: string;
  full_name: string;
  role: Role;
  status: "invited" | "active" | "suspended";
  card_id: string | null;
  title?: string;
  department_id?: string | null;
  department_name?: string | null;
  invited_at: string;
  invite_sent_at?: string | null;
  can_resend_at?: string | null;
  joined_at: string | null;
  /** Whether this employee shares their new contacts with the company (null for owners and admins). Only the employee can change it. */
  share_contacts?: boolean | null;
}

/** The caller's own place in a company: the employee's "share my new contacts with the company" switch. */
export interface MyMembership {
  member_id: string;
  role: Role;
  can_share_contacts: boolean;
  share_contacts: boolean;
  share_contacts_changed_at: string | null;
}

export type LeadStatus = "new" | "contacted" | "qualified" | "won" | "lost";
export interface Lead {
  id: string;
  card_id: string | null;
  card_name: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  note: string;
  /** exchange, meeting_request, scanned_card, event, or an older link, qr, nfc, email. */
  source: string;
  /** Event mode: hot, warm or follow_up (empty when none). */
  tag?: string;
  event_name?: string;
  channel?: string;
  meeting_times?: string[];
  status: LeadStatus;
  /** The colleague the lead was given to (company workspaces). */
  assignee?: { id: string; name: string; email: string } | null;
  assigned_at?: string | null;
  consented_at?: string | null;
  note_count?: number;
  /** The card holder shared this contact with the company (their switch was on when it arrived). */
  shared_with_company?: boolean;
  created_at: string;
}

export interface Totals {
  views: number;
  unique_visitors: number;
  scans: number;
  taps: number;
  saves: number;
  leads: number;
  link_clicks: number;
}

export interface Analytics {
  totals: Totals;
  prev_totals: Totals;
  series: { date: string; views: number; saves: number; leads: number; link_clicks?: number }[];
  period?: { from: string; to: string; days: number; prev_from: string; tz: string; group?: string };
  sources: { key: "nfc" | "qr" | "link" | "email" | "other"; count: number }[];
  locations: { country: string; count: number }[];
  devices: { key: "ios" | "android" | "desktop" | "other"; count: number }[];
  hours: number[];
  top_buttons: { kind: string; count: number }[];
  cards: { card_id: string; name: string; views: number; saves: number; leads: number; leads_visible?: boolean }[];
}

// ---- public card page

export interface PublicCardData {
  name: string;
  title: string;
  company: string;
  address: string;
  bio?: string;
  photo_url: string | null;
  cover_url?: string | null;
  items: { kind: ItemKind; value: string; label: string; icon?: ItemIcon | null }[];
  save_contact: boolean;
  features?: PublicFeatures;
  /** Language of the page: a fixed one, or "auto" (the visitor's own). */
  language?: "en" | "ar" | "auto";
  /** Search engines may list this page (the card's owner turned it on). */
  seo_indexable?: boolean;
  design: Design;
  /** The company's own face, when the card's design names one (company cards only). */
  custom_face?: import("@/lib/library/custom/types").CustomFaceData | null;
  footer: boolean;
  /** Company cards only (see "Company branding" in the API contract). */
  brand: (BrandLook & { company_name: string; verified_domain?: string | null }) | null;
  public_url: string;
  vcard_url: string;
  qr_url: string;
}

export type PublicCardResponse =
  | {
      state: "live";
      canonical: string;
      card: PublicCardData;
      og: { title: string; description: string; image_url: string | null };
    }
  | { state: "paused"; company_name: string | null; message: string }
  | { state: "suspended"; company_name: string | null; website: string | null; message: string };

export type EventType = "view" | "tap" | "save" | "link_click";
export type EventSource = "nfc" | "qr" | "link" | "email";

// ---- company operations

export type FieldPermission = "free" | "approval" | "locked";
export type ButtonPermissions = { add: FieldPermission; edit: FieldPermission; remove: FieldPermission };
export interface MandatoryButton {
  kind: ItemKind;
  value: string;
  label: string;
}

/** What an employee may do on their card, as the card payload tells the editor. */
/** What the menu shows for orders and bookings, and the extras a person may add. */
export interface CommerceAccess {
  orders: boolean;
  bookings: boolean;
  extras: ExtraKind[];
}

/** The extras that can go under a card. */
export type ExtraKind = "video" | "products" | "hours" | "booking" | "team" | "gallery" | "event" | "map";
export const EXTRA_KINDS: readonly ExtraKind[] = ["video", "products", "hours", "booking", "team", "gallery", "event", "map"];
export type ExtrasMode = "all" | "some" | "none";

export interface FieldAccess {
  name: FieldPermission;
  title: FieldPermission;
  photo: FieldPermission;
  company: FieldPermission;
  address: FieldPermission;
  /** The short bio follows the address rule; the API may leave it out. */
  bio?: FieldPermission;
  /** The web address, the card features (exchange form) and the contact-file options: free or locked. */
  slug: FieldPermission;
  features: FieldPermission;
  vcard: FieldPermission;
  buttons: ButtonPermissions;
  allowed_kinds: ItemKind[] | null;
  banned_domains: string[];
  mandatory_buttons: MandatoryButton[];
  /** The extras (video, shop, hours ...) this person may add to their card. The API may leave it out for older answers: everything is then allowed. */
  extras?: ExtraKind[];
}

export interface PendingChange {
  id: string;
  field: string;
  created_at: string;
}

/** The company rules, as stored. */
export interface FieldRules {
  name: FieldPermission;
  title: FieldPermission;
  photo: FieldPermission;
  company: FieldPermission;
  address: FieldPermission;
  /** Settings an employee may change: "free" or "locked" ("approval" acts as locked). */
  slug: FieldPermission;
  features: FieldPermission;
  vcard: FieldPermission;
  button_add: FieldPermission;
  button_edit: FieldPermission;
  button_remove: FieldPermission;
  allowed_kinds: ItemKind[] | null;
  banned_domains: string[];
  mandatory_buttons: MandatoryButton[];
  /** What employees may add under their cards: everything, only the kinds in extra_kinds, or nothing. */
  extras: ExtrasMode;
  extra_kinds: ExtraKind[];
}

export type ChangeStatus = "pending" | "approved" | "rejected" | "withdrawn" | "superseded";
export interface PersonRef {
  id: string;
  full_name: string;
  email: string;
}
export interface ChangeRequest {
  id: string;
  card_id: string;
  card_name: string;
  field: "name" | "title" | "company" | "address" | "bio" | "photo" | "buttons";
  old: unknown;
  new: unknown;
  status: ChangeStatus;
  requested_by: PersonRef | null;
  decided_by: PersonRef | null;
  decided_at: string | null;
  reason: string;
  created_at: string;
}

export interface DepartmentDesign {
  face?: number;
  colour?: number;
  below?: number;
  intro?: number;
  font?: string;
  size?: number;
}
export interface Department {
  id: string;
  name: string;
  design: DepartmentDesign;
  items: MandatoryButton[];
  mandatory_items: MandatoryButton[];
  member_count: number;
  created_at: string;
}

export interface AuditEvent {
  id: string;
  action: string;
  label: string;
  actor: { id: string | null; full_name: string; email: string } | null;
  target_type: string;
  target_id: string;
  target_label: string;
  details: Record<string, unknown>;
  created_at: string;
}
export interface AuditPage {
  count: number;
  page: number;
  pages: number;
  page_size: number;
  results: AuditEvent[];
  actors: { id: string; full_name: string; email: string }[];
  actions: { key: string; label: string }[];
}

export interface BulkItemResult {
  id: string;
  name: string;
  ok: boolean;
  reason: string | null;
  code: string | null;
}
export interface BulkResult {
  action: string;
  total: number;
  ok: number;
  failed: number;
  results: BulkItemResult[];
}

export interface DirectoryEntry {
  code: string;
  name: string;
  title: string;
  department: string | null;
  photo_url: string | null;
  url: string;
}
export interface DirectoryPage {
  company: {
    name: string;
    slug: string;
    website: string | null;
    logo_url: string | null;
    symbol_url: string | null;
    palette: BrandPalette | null;
    logo_display: string;
    show_company_name: boolean;
    /** The company's proven e-mail domain, or null. */
    verified_domain?: string | null;
    /** Where the directory lives: the company's own domain once verified, else the Bench /d/<slug> address. */
    url?: string | null;
  };
  total: number;
  count: number;
  page: number;
  pages: number;
  page_size: number;
  departments: { id: string; name: string; count: number }[];
  results: DirectoryEntry[];
}
