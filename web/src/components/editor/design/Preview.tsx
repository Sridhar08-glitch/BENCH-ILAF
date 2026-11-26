"use client";

// Live card drawings used by the design picker: a lazily drawn thumbnail and the small preview of the whole choice.
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CardView } from "@/components/card/CardView";
import type { CardPageData } from "@/lib/library/types";
import { dirOf } from "@/lib/i18n";

/** The card page is drawn at this width and scaled into the box. */
const PAGE_W = 390;

/**
 * A card page drawn at phone width and scaled down to `width` pixels wide, cropped to `ratio` x its width.
 * The frame always lays out left to right so the scaling starts from the same corner in every language;
 * `dir` is the direction of the card inside it (the card's own language).
 */
export function Scaled({ width, ratio, dir = "ltr", children }: { width: number; ratio: number; dir?: "ltr" | "rtl"; children: ReactNode }) {
  return (
    <div className="scaled-box" style={{ direction: "ltr", width, height: Math.round(width * ratio), position: "relative", overflow: "hidden", borderRadius: 6, background: "var(--surface-2)", boxShadow: "inset 0 0 0 1px var(--line)" }}>
      <div dir={dir} style={{ position: "absolute", insetBlockStart: 0, insetInlineStart: 0, width: PAGE_W, transformOrigin: "top left", transform: `scale(${width / PAGE_W})` }}>{children}</div>
    </div>
  );
}

/** True while the element is near the screen (or always where the browser cannot tell), so a long list only draws what is around the viewer. */
function useSeen(): [React.RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver((entries) => setSeen(entries[entries.length - 1].isIntersecting), { rootMargin: "400px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, seen];
}

interface ThumbProps {
  base: Omit<CardPageData, "design">;
  /** The design is passed as plain values so a thumbnail only redraws when one of them changes. */
  face: number;
  colour: number;
  /** 0 draws the face card; 1 to 27 a page-style header in its place. */
  top?: number;
  below: number;
  photo: boolean;
  brand_colors: boolean;
  foot: boolean;
  /** The typeface and size of the name, title and contact lines. */
  font: string;
  size: number;
  width: number;
  ratio: number;
}

/** One small live card. It is only drawn while it is near the screen, so a long list stays light. */
export const Thumb = memo(function Thumb({ base, face, colour, top = 0, below, photo, brand_colors, foot, font, size, width, ratio }: ThumbProps) {
  const [ref, seen] = useSeen();
  const data = useMemo<CardPageData>(
    () => ({ ...base, design: { face, colour, top, below, intro: 0, font, size, photo, brand_colors, foot } }),
    [base, face, colour, top, below, font, size, photo, brand_colors, foot],
  );
  return (
    <div ref={ref} aria-hidden="true">
      {seen ? (
        <Scaled width={width} ratio={ratio} dir={dirOf(data.locale ?? "en")}>
          <CardView data={data} mode="thumb" autoplay={false} />
        </Scaled>
      ) : (
        <div style={{ width, height: Math.round(width * ratio), borderRadius: 6, background: "var(--surface-2)" }} />
      )}
    </div>
  );
});
