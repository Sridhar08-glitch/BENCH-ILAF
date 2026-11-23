// Builds the GuideContext from data the dashboard already loads. Every input is optional: while something is
// still loading the matching facts read as "not done", and the checklist simply shows less progress.
import type { Brand, Card, Design, FieldRules, Member } from "@/lib/types";
import { flagsOf } from "./engine";
import type { GuideContext, ProgressItem } from "./types";

/** What a brand-new card or a brand-new company starts with; a different face, colour, layout or opening counts as a choice. */
export const NEW_LOOK = { face: 1, colour: 0, below: 1, intro: 1 } as const;

export interface GuideInput {
  userId: string;
  kind: "personal" | "company";
  role: "owner" | "admin" | "employee";
  cards?: Card[] | null;
  /** The company's brand (company workspaces only). */
  brand?: Brand | null;
  members?: Member[] | null;
  /** The total number of contacts (the "count" of a contacts list call). */
  leadsCount?: number | null;
  departmentsCount?: number | null;
  webhooksCount?: number | null;
  fieldRules?: FieldRules | null;
  progress?: ProgressItem[] | null;
}

export function emptyContext(): GuideContext {
  return {
    is_company: false, is_manager: false, card_id: null, cards_count: 0, published_count: 0,
    has_name: false, has_title: false, has_photo: false, items_count: 0, design_changed: false, card_published: false,
    shared_qr_opened: false, signature_copied: false, background_opened: false, approval_sent: false,
    brand_logo_set: false, brand_colours_set: false, brand_style_set: false, lock_enabled: false,
    team_size: 0, invites_sent: 0, members_active: 0, departments_count: 0, leads_count: 0, webhooks_count: 0,
    directory_enabled: false, approval_rules: false, invite_accepted: false,
  };
}

function lookChanged(d: Pick<Design, "face" | "colour" | "below" | "intro"> | null | undefined): boolean {
  if (!d) return false;
  return d.face !== NEW_LOOK.face || d.colour !== NEW_LOOK.colour || d.below !== NEW_LOOK.below || d.intro !== NEW_LOOK.intro;
}

/** The person's own card: the one they own, else the first one. */
export function myCard(cards: Card[] | null | undefined, userId: string): Card | null {
  if (!cards || cards.length === 0) return null;
  return cards.find((c) => c.owner?.id === userId) ?? cards[0];
}

const APPROVAL_FIELDS = ["name", "title", "photo", "company", "address", "button_add", "button_edit", "button_remove"] as const;

export function hasApprovalRules(r: FieldRules | null | undefined): boolean {
  return !!r && APPROVAL_FIELDS.some((k) => (r[k] as string) === "approval");
}

export function buildContext(input: GuideInput): GuideContext {
  const ctx = emptyContext();
  const cards = input.cards ?? [];
  const mine = myCard(cards, input.userId);
  const flags = flagsOf(input.progress ?? []);
  ctx.is_company = input.kind === "company";
  ctx.is_manager = input.role === "owner" || input.role === "admin";
  ctx.card_id = mine?.id ?? null;
  ctx.cards_count = cards.length;
  ctx.published_count = cards.filter((c) => c.status === "published").length;
  ctx.has_name = !!mine?.name?.trim();
  ctx.has_title = !!mine?.title?.trim();
  ctx.has_photo = !!mine?.photo_url;
  ctx.items_count = mine ? mine.items.filter((i) => i.on !== false && !!(i.value || "").trim()).length : 0;
  ctx.design_changed = lookChanged(mine?.design);
  ctx.card_published = mine?.status === "published";
  ctx.shared_qr_opened = !!flags.shared_qr_opened;
  ctx.signature_copied = !!flags.signature_copied;
  ctx.background_opened = !!flags.background_opened;
  ctx.approval_sent = !!flags.approval_sent;

  const brand = input.brand;
  if (brand) {
    ctx.brand_logo_set = !!brand.logo_url;
    ctx.brand_colours_set = !!brand.colours?.primary;
    ctx.brand_style_set = lookChanged(brand.design);
    ctx.lock_enabled = !!brand.lock_design;
    ctx.directory_enabled = !!brand.directory_enabled;
  }
  const others = (input.members ?? []).filter((m) => m.user?.id !== input.userId && m.role !== "owner");
  ctx.team_size = others.length;
  ctx.invites_sent = others.length;
  ctx.members_active = others.filter((m) => m.status === "active").length;
  ctx.departments_count = input.departmentsCount ?? 0;
  ctx.leads_count = input.leadsCount ?? 0;
  ctx.webhooks_count = input.webhooksCount ?? 0;
  ctx.approval_rules = hasApprovalRules(input.fieldRules);
  ctx.invite_accepted = input.kind === "company" && input.role === "employee";
  return ctx;
}
