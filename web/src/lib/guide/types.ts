// The shapes of the guide system. Guides, steps, tours and prompts are plain data (see guides.ts, tours.ts,
// whatnext.ts); the engine in engine.ts reads them. Nothing here touches the browser.
import type { MessageKey } from "@/lib/i18n";

export type Audience = "personal" | "company_owner" | "company_admin" | "employee";
export const AUDIENCES: readonly Audience[] = ["personal", "company_owner", "company_admin", "employee"];

/** Facts about the person's work, built from the data the dashboard already loads (see context.ts). */
export interface GuideContext {
  is_company: boolean;
  is_manager: boolean;
  /** The id of the person's own card (or the first one), for deep links into the editor. */
  card_id: string | null;
  cards_count: number;
  published_count: number;
  has_name: boolean;
  has_title: boolean;
  has_photo: boolean;
  items_count: number;
  /** The card's face, colours, layout or opening differ from a new card. */
  design_changed: boolean;
  card_published: boolean;
  /** Client flags: kept as guide progress because the server cannot see them. */
  shared_qr_opened: boolean;
  signature_copied: boolean;
  approval_sent: boolean;
  // company
  brand_logo_set: boolean;
  brand_colours_set: boolean;
  brand_style_set: boolean;
  lock_enabled: boolean;
  /** Other people in the company: invited, active or suspended. */
  team_size: number;
  invites_sent: number;
  members_active: number;
  departments_count: number;
  leads_count: number;
  webhooks_count: number;
  directory_enabled: boolean;
  /** At least one field rule says "needs approval". */
  approval_rules: boolean;
  /** An employee in a company is by definition someone who accepted an invite. */
  invite_accepted: boolean;
}
export type ContextKey = keyof GuideContext;

/** A declarative check of the context, so a step can be stored and tested as data. */
export type Condition =
  | { is: ContextKey }
  | { gte: [ContextKey, number] }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

export interface Step {
  id: string;
  title: MessageKey;
  text: MessageKey;
  /** The page to open. "{card}" is replaced by the person's card id (or the cards list when there is none). */
  route: string;
  /** Done when this holds. A step without one is finished only by hand. */
  doneWhen?: Condition;
  /** Shown only when this holds (an approval step only where approval rules exist). */
  appliesWhen?: Condition;
  /** Optional steps never block "all done". */
  optional?: boolean;
  /** Button label key; defaults to the shared "Open" text. */
  action?: MessageKey;
  /** What to point at when the person arrives from this step (?guide=<id>). A missing element is simply not highlighted. */
  focus?: { target: string; openFirst?: string };
}

export interface Guide {
  id: Audience;
  title: MessageKey;
  intro: MessageKey;
  steps: Step[];
}

/** What a person did with a step by hand, as stored by the API. */
export type StepMark = "done" | "skipped" | "dismissed";
export type ProgressState = "done" | "skipped" | "dismissed" | "shown" | "up" | "down";
export interface ProgressItem {
  guide_id: string;
  step_id: string;
  state: ProgressState;
  updated?: string;
}

export type StepStatus = "done" | "skipped" | "todo";
export interface StepView {
  step: Step;
  status: StepStatus;
  /** True when the data (not a click) says it is done. */
  auto: boolean;
  href: string;
}
export interface GuideView {
  guide: Guide;
  steps: StepView[];
  /** Steps that count (applicable, not optional). */
  total: number;
  finished: number;
  /** 0 to 100 */
  percent: number;
  complete: boolean;
  next: StepView | null;
}

export interface Tip {
  /** A CSS selector for what to point at, normally `[data-guide="..."]`. */
  target: string;
  title: MessageKey;
  text: MessageKey;
  /** A selector to click first so the target exists (a tab that is not open yet). */
  openFirst?: string;
}
export interface Tour {
  id: string;
  /** The page the tour belongs to (an exact path, or a path prefix when `prefix` is true). */
  route: string;
  prefix?: boolean;
  title: MessageKey;
  tips: Tip[];
}

/** A small prompt shown once after a key action. */
export interface NextPrompt {
  event: string;
  title: MessageKey;
  text: MessageKey;
  action: MessageKey;
  route: string;
}
