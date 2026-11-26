"use client";

// The extras under the card (video, products, hours, booking, event, map, gallery) as a visitor would see them, drawn in
// the editor's preview with the same section components as the live page. The editor keeps these in separate lists,
// so they are put into the public shape here. Team cards are only expanded by the live page and are left out.
import { useQuery } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import { CommerceLayer } from "@/app/c/[code]/CommerceLayer";
import { Sections } from "@/components/card/sections/Sections";
import { commerceApi, commerceKeys } from "@/lib/api-commerce";
import { contentApi, contentKeys } from "@/lib/api-content";
import type { PublicProduct, PublicSection } from "@/lib/public-api";
import { useI18n } from "@/lib/i18n/client";
import { cardLocale } from "@/lib/i18n";

/** The few facts of the card the extras need (the editor and the preview tab both have them). */
export interface ExtrasCard {
  id: string;
  public_code: string;
  public_url: string;
  video_url?: string | null;
  video_poster_url?: string | null;
}

export function ExtrasPreview({ card, name, language, pageVars }: { card: ExtrasCard; name: string; language: string | undefined; pageVars: Record<string, string> }) {
  const { t, locale } = useI18n();
  const sectionsQ = useQuery({ queryKey: contentKeys.sections(card.id), queryFn: () => contentApi.sections(card.id) });
  const productsQ = useQuery({ queryKey: commerceKeys.products(card.id), queryFn: () => commerceApi.products(card.id) });
  const galleryQ = useQuery({ queryKey: contentKeys.gallery(card.id), queryFn: () => contentApi.gallery(card.id) });

  const list: PublicSection[] = (sectionsQ.data ?? [])
    .filter((s) => s.on && s.kind !== "team")
    .map((s): PublicSection => {
      if (s.kind === "products") {
        const items: PublicProduct[] = (productsQ.data ?? [])
          .filter((p) => p.on && (p.section_id === s.id || p.section_id === null))
          .sort((a, b) => a.order - b.order)
          .map((p) => ({ id: p.id, title: p.title, description: p.description, price: p.price, currency: p.currency, image_url: p.image_url, badge: p.badge, meta: p.meta, stock: p.stock }));
        return { id: s.id, kind: "products", order: s.order, data: { ...s.data, items } };
      }
      if (s.kind === "gallery") return { id: s.id, kind: "gallery", order: s.order, data: { ...s.data, images: galleryQ.data ?? [] } };
      return { id: s.id, kind: s.kind, order: s.order, data: s.data } as PublicSection;
    });

  const videoUrl = card.video_url ?? null;
  const posterUrl = card.video_poster_url ?? null;
  const lang = cardLocale((language ?? "auto") as Parameters<typeof cardLocale>[0], locale);
  if (list.length === 0) return null;
  return (
    // Everything works as on the live card (play the video, fill the basket, open the calendar); the order and the booking forms send nothing.
    <div style={{ ...pageVars, background: "var(--pgbg)", color: "var(--pgfg)", padding: "8px 0 8px" } as CSSProperties}>
      <CommerceLayer code={card.public_code} source={null} name={name} preview />
      <Sections sections={list} ctx={{ t, locale: lang, code: card.public_code, publicUrl: card.public_url, name, videoUrl, posterUrl }} />
    </div>
  );
}
