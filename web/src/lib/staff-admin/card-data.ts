// A card of the staff API turned into what the card renderer draws.
import type { CardPageData } from "@/lib/library/types";
import type { CardRow } from "./api";

/** The language of the words around the card: Arabic when the card says so, otherwise English (staff screens are English). */
export function localeOf(language: string | undefined): "en" | "ar" {
  return language === "ar" ? "ar" : "en";
}

export function pageDataOf(card: CardRow): CardPageData {
  return {
    name: card.name, title: card.title, company: card.company, address: card.address, photoUrl: card.photo_url, coverUrl: card.cover_url,
    items: card.items.filter((i) => i.on !== false).map((i) => ({ kind: i.kind, value: i.value, label: i.label, on: i.on })),
    saveContact: card.save_contact, design: card.design as unknown as CardPageData["design"], publicUrl: card.public_url, locale: localeOf(card.language),
  };
}

/** Plain words for a card status. */
export function cardStatusWord(card: Pick<CardRow, "status" | "staff_hold">): string {
  if (card.status === "suspended") return card.staff_hold ? "Suspended by staff" : "Suspended by the company";
  return card.status === "published" ? "Live" : "Draft";
}
