"use client";

// The end of the card page (QR code of a page style, "Powered by" line), drawn after the extras under the card.
import { useMemo } from "react";
import { buildInput, drawPage } from "@/lib/library/render";
import { splitTail } from "@/lib/library/tail";
import { useBrandInfo } from "@/lib/brand-info-client";
import type { CardPageData } from "@/lib/library/types";
import { CardMarkup } from "./CardMarkup";

export function CardTail({ data }: { data: CardPageData }) {
  const brand = useBrandInfo(data.brand);
  const full = useMemo(() => (brand === data.brand ? data : { ...data, brand }), [data, brand]);
  const out = useMemo(() => drawPage(buildInput(full, "live", false), full, "live"), [full]);
  const { tail } = useMemo(() => splitTail(out.html), [out.html]);
  if (!tail) return null;
  return <CardMarkup html={`<div class="pg" style="padding-top:0">${tail}</div>`} pageVars={out.pageVars} wrapClass={out.wrapClass} />;
}
