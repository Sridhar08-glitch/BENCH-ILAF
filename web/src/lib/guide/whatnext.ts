// "What next" data: the small prompt shown once after a key action, the suggestions that follow a finished step,
// and the suggestions shown when a whole guide is done. Texts live in lib/i18n/en/guide.ts.
import { tk } from "@/lib/i18n";
import type { Condition, NextPrompt } from "./types";

/** One prompt per key event. An event is shown to a person only once (the engine records it). */
export const PROMPTS: NextPrompt[] = [
  { event: "card_published", title: tk("guide.next.cardPublished.title"), text: tk("guide.next.cardPublished.text"), action: tk("guide.next.cardPublished.action"), route: "/app/qr" },
  { event: "first_invite_sent", title: tk("guide.next.invite.title"), text: tk("guide.next.invite.text"), action: tk("guide.next.invite.action"), route: "/app/fields" },
  { event: "brand_saved", title: tk("guide.next.brand.title"), text: tk("guide.next.brand.text"), action: tk("guide.next.brand.action"), route: "/app/team" },
  { event: "first_lead", title: tk("guide.next.lead.title"), text: tk("guide.next.lead.text"), action: tk("guide.next.lead.action"), route: "/app/contacts" },
  { event: "export_done", title: tk("guide.next.export.title"), text: tk("guide.next.export.text"), action: tk("guide.next.export.action"), route: "/app/settings/integrations" },
];

export function promptFor(event: string): NextPrompt | null {
  return PROMPTS.find((p) => p.event === event) ?? null;
}

/** Something worth doing that is not a checklist step. */
export interface Suggestion {
  id: string;
  title: ReturnType<typeof tk>;
  text: ReturnType<typeof tk>;
  route: string;
  action: ReturnType<typeof tk>;
  /** Hidden when this does not hold (inviting a team only makes sense for a company manager). */
  when?: Condition;
  /** Hidden once this holds. */
  doneWhen?: Condition;
}

export const SUGGESTIONS: Record<string, Suggestion> = {
  qr: {
    id: "qr",
    title: tk("guide.sug.qr.title"),
    text: tk("guide.sug.qr.text"),
    route: "/app/qr",
    action: tk("guide.sug.qr.action"),
    doneWhen: { is: "shared_qr_opened" },
  },
  signature: {
    id: "signature",
    title: tk("guide.sug.signature.title"),
    text: tk("guide.sug.signature.text"),
    route: "/app/signature",
    action: tk("guide.sug.signature.action"),
    doneWhen: { is: "signature_copied" },
  },
  background: {
    id: "background",
    title: tk("guide.sug.background.title"),
    text: tk("guide.sug.background.text"),
    route: "/app/background",
    action: tk("guide.sug.background.action"),
    doneWhen: { is: "background_opened" },
  },
  team: {
    id: "team",
    title: tk("guide.sug.team.title"),
    text: tk("guide.sug.team.text"),
    route: "/app/team",
    action: tk("guide.sug.team.action"),
    when: { all: [{ is: "is_company" }, { is: "is_manager" }] },
    doneWhen: { gte: ["invites_sent", 1] },
  },
  contacts: {
    id: "contacts",
    title: tk("guide.sug.contacts.title"),
    text: tk("guide.sug.contacts.text"),
    route: "/app/contacts",
    action: tk("guide.sug.contacts.action"),
    doneWhen: { gte: ["leads_count", 1] },
  },
};

/** After this step is finished, suggest these (in order) before falling back to the next unfinished step. */
export const FOLLOW_UPS: Record<string, string[]> = {
  profile: [],
  buttons: [],
  design: [],
  publish: ["qr", "signature"],
  share: ["signature", "background"],
  brand: [],
  "card-style": [],
  lock: [],
  invite: ["contacts"],
  departments: [],
  "publish-cards": ["qr", "signature"],
  directory: ["qr", "team"],
  "accept-invite": [],
  "fill-details": [],
  "send-approval": [],
};

/** Suggested once every step is done: share the QR code, the e-mail signature, the call background, the team. */
export const ALL_DONE: string[] = ["qr", "signature", "background", "team"];
