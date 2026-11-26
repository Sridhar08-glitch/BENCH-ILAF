// The order of the step-by-step editor. Pure, so the order and the skipping rules are tested on their own.
import { tk, type MessageKey } from "@/lib/i18n";
import type { StepKey } from "./design/logic";
import type { DesignFields } from "@/lib/library/fieldsUsed";

export const GUIDED = ["look", "colour", "details", "buttons", "below", "extras", "settings", "share"] as const;
export type GuidedKey = (typeof GUIDED)[number];

export const GUIDED_LABELS: Record<GuidedKey, MessageKey> = {
  look: tk("editor.gsLook"), colour: tk("editor.gsColour"), details: tk("editor.gsDetails"), buttons: tk("editor.gsButtons"),
  below: tk("editor.gsBelow"), extras: tk("editor.gsExtras"), settings: tk("editor.gsSettings"), share: tk("editor.gsShare"),
};

/** The design picker's own steps that each guided step shows. The last colour sub-step (finish) holds the switches that depend on the design: photo, brand colours, footer. */
export const DESIGN_STEPS: Partial<Record<GuidedKey, readonly StepKey[]>> = {
  look: ["top", "face"],
  colour: ["colour", "text", "anim", "finish"],
  below: ["below"],
};

/** The steps this card walks through (no layout step under a page style): a company-locked design has no look, colour or layout step, and the extras follow the page-styles switch. */
export function guidedSteps(opts: { locked: boolean; extras: boolean; header?: boolean }): GuidedKey[] {
  // A page style (header) comes with its own button layout, chosen for it, so there is nothing to pick under the card.
  return GUIDED.filter((k) => !(opts.locked && k in DESIGN_STEPS) && !(k === "extras" && !opts.extras) && !(k === "below" && opts.header));
}

export const nextOf = (steps: readonly GuidedKey[], k: GuidedKey): GuidedKey => steps[Math.min(steps.indexOf(k) + 1, steps.length - 1)] ?? k;
export const prevOf = (steps: readonly GuidedKey[], k: GuidedKey): GuidedKey => steps[Math.max(steps.indexOf(k) - 1, 0)] ?? k;

/** The names the guided tours know the steps by (they were the tabs of the old editor). */
export const TOUR_NAMES: Record<GuidedKey, string> = { look: "look", colour: "look", details: "profile", buttons: "buttons", below: "look", extras: "content", settings: "profile", share: "profile" };

/** The name of each detail in a sentence such as "This design does not show: company, address". */
export const FIELD_LABELS: Record<keyof DesignFields, MessageKey> = {
  title: tk("editor.field_title"), company: tk("editor.field_company"), address: tk("editor.field_address"),
  bio: tk("editor.field_bio"), photo: tk("editor.field_photo"), cover: tk("editor.field_cover"),
};
