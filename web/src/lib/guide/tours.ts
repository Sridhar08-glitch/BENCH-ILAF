// The page tours, as data. Each tour belongs to one page and points at elements marked with data-guide="...".
// A tip whose element is missing (an empty list, a hidden panel on a phone, a role without that button) is skipped.
// To add a tour: add the data-guide attribute in the page, add an entry here and the texts in lib/i18n/en/guide.ts.
import { tk } from "@/lib/i18n";
import type { Tour } from "./types";

const at = (name: string) => `[data-guide="${name}"]`;

export const TOURS: Tour[] = [
  {
    id: "cards",
    route: "/app/cards",
    title: tk("guide.tour.cards.title"),
    tips: [
      { target: at("cards-new"), title: tk("guide.tour.cards.new.title"), text: tk("guide.tour.cards.new.text") },
      { target: at("cards-list"), title: tk("guide.tour.cards.list.title"), text: tk("guide.tour.cards.list.text") },
      { target: at("cards-actions"), title: tk("guide.tour.cards.actions.title"), text: tk("guide.tour.cards.actions.text") },
    ],
  },
  {
    id: "editor",
    route: "/app/cards/",
    prefix: true,
    title: tk("guide.tour.editor.title"),
    tips: [
      { target: at("editor-tabs"), title: tk("guide.tour.editor.tabs.title"), text: tk("guide.tour.editor.tabs.text") },
      { target: at("editor-body"), openFirst: at("editor-tab-buttons"), title: tk("guide.tour.editor.buttons.title"), text: tk("guide.tour.editor.buttons.text") },
      { target: at("editor-body"), openFirst: at("editor-tab-look"), title: tk("guide.tour.editor.design.title"), text: tk("guide.tour.editor.design.text") },
      { target: at("preview"), title: tk("guide.tour.editor.preview.title"), text: tk("guide.tour.editor.preview.text") },
      { target: at("editor-publish"), title: tk("guide.tour.editor.publish.title"), text: tk("guide.tour.editor.publish.text") },
      { target: at("editor-qr"), title: tk("guide.tour.editor.share.title"), text: tk("guide.tour.editor.share.text") },
    ],
  },
  {
    id: "brand",
    route: "/app/brand",
    title: tk("guide.tour.brand.title"),
    tips: [
      { target: at("brand-steps"), title: tk("guide.tour.brand.steps.title"), text: tk("guide.tour.brand.steps.text") },
      { target: at("brand-body"), title: tk("guide.tour.brand.body.title"), text: tk("guide.tour.brand.body.text") },
      { target: at("preview"), title: tk("guide.tour.brand.preview.title"), text: tk("guide.tour.brand.preview.text") },
      { target: at("brand-next"), title: tk("guide.tour.brand.next.title"), text: tk("guide.tour.brand.next.text") },
    ],
  },
  {
    id: "team",
    route: "/app/team",
    title: tk("guide.tour.team.title"),
    tips: [
      { target: at("team-invite"), title: tk("guide.tour.team.invite.title"), text: tk("guide.tour.team.invite.text") },
      { target: at("team-import"), title: tk("guide.tour.team.import.title"), text: tk("guide.tour.team.import.text") },
      { target: at("team-filters"), title: tk("guide.tour.team.filters.title"), text: tk("guide.tour.team.filters.text") },
      { target: at("team-list"), title: tk("guide.tour.team.list.title"), text: tk("guide.tour.team.list.text") },
    ],
  },
  {
    id: "contacts",
    route: "/app/contacts",
    title: tk("guide.tour.contacts.title"),
    tips: [
      { target: at("contacts-tabs"), title: tk("guide.tour.contacts.tabs.title"), text: tk("guide.tour.contacts.tabs.text") },
      { target: at("contacts-filters"), title: tk("guide.tour.contacts.filters.title"), text: tk("guide.tour.contacts.filters.text") },
      { target: at("contacts-list"), title: tk("guide.tour.contacts.list.title"), text: tk("guide.tour.contacts.list.text") },
      { target: at("contacts-export"), title: tk("guide.tour.contacts.export.title"), text: tk("guide.tour.contacts.export.text") },
    ],
  },
  {
    id: "analytics",
    route: "/app/analytics",
    title: tk("guide.tour.analytics.title"),
    tips: [
      { target: at("analytics-tabs"), title: tk("guide.tour.analytics.tabs.title"), text: tk("guide.tour.analytics.tabs.text") },
      { target: at("analytics-range"), title: tk("guide.tour.analytics.range.title"), text: tk("guide.tour.analytics.range.text") },
      { target: at("analytics-body"), title: tk("guide.tour.analytics.body.title"), text: tk("guide.tour.analytics.body.text") },
    ],
  },
  {
    id: "integrations",
    route: "/app/settings/integrations",
    title: tk("guide.tour.integrations.title"),
    tips: [
      { target: at("integrations-add"), title: tk("guide.tour.integrations.add.title"), text: tk("guide.tour.integrations.add.text") },
      { target: at("integrations-list"), title: tk("guide.tour.integrations.list.title"), text: tk("guide.tour.integrations.list.text") },
      { target: at("integrations-connect"), title: tk("guide.tour.integrations.connect.title"), text: tk("guide.tour.integrations.connect.text") },
    ],
  },
];

/** The tour of a page: an exact path match first, then the longest prefix tour. */
export function tourFor(pathname: string): Tour | null {
  const path = pathname.split("?")[0].replace(/\/+$/, "") || "/";
  const exact = TOURS.find((t) => !t.prefix && t.route === path);
  if (exact) return exact;
  const prefixed = TOURS.filter((t) => t.prefix && path.startsWith(t.route)).sort((a, b) => b.route.length - a.route.length);
  return prefixed[0] ?? null;
}
