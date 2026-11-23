"use client";

// A card as the customer sees it: the real card renderer, drawn small (only while it is near the screen).
import { useMemo } from "react";
import { Scaled } from "@/components/editor/design/Preview";
import { CardView } from "@/components/card/CardView";
import type { CardPageData } from "@/lib/library/types";
import type { CardRow } from "@/lib/staff-admin/api";
import { pageDataOf } from "@/lib/staff-admin/card-data";
import { useVisible } from "./useVisible";

export function StaffCardThumb({ card, width = 120, ratio = 1.5 }: { card: CardRow; width?: number; ratio?: number }) {
  const [ref, seen] = useVisible<HTMLDivElement>();
  const data = useMemo<CardPageData>(() => pageDataOf(card), [card]);
  return (
    <div ref={ref} aria-hidden="true" style={{ width }}>
      {seen ? (
        <Scaled width={width} ratio={ratio} dir={data.locale === "ar" ? "rtl" : "ltr"}>
          <CardView data={data} mode="thumb" autoplay={false} />
        </Scaled>
      ) : (
        <div style={{ width, height: Math.round(width * ratio), borderRadius: 6, background: "var(--surface-2)" }} />
      )}
    </div>
  );
}
