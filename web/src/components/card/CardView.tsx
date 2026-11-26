"use client";

// The whole card page for the editor, the brand preview and the landing page: the card face, the Save contact
// button and the area below it, drawn here in the browser so the owner sees edits at once. The public page does
// not use this file: it draws the same markup on the server (see app/c/[code]) and only loads CardBehaviour.
import { useMemo } from "react";
import { buildInput, drawPage, renderTab } from "@/lib/library/render";
import { useBrandInfo } from "@/lib/brand-info-client";
import type { CardMode, CardPageData } from "@/lib/library/types";
import { CardBehaviour } from "./CardBehaviour";
import { CardMarkup } from "./CardMarkup";
import { splitTail } from "@/lib/library/tail";

export type { CardMode };
export type CardViewData = CardPageData;

interface Props {
  data: CardViewData;
  mode?: CardMode;
  onSave?: () => void;
  onItemClick?: (kind: string) => void;
  /** Fill the whole screen height (public page). */
  fullHeight?: boolean;
  /** Change this value to play the opening animation again. */
  playKey?: string | number;
  /** Play the opening animation. Defaults to on for everything except thumbnails. */
  autoplay?: boolean;
  /** Show the QR back first (screenshots). */
  flipped?: boolean;
  /** Leave out the end of the page (QR code, "Powered by"): the caller draws it after the extras, with CardTail. */
  noTail?: boolean;
}

export function CardView({ data, mode = "preview", onSave, onItemClick, fullHeight, playKey = 0, autoplay, flipped, noTail }: Props) {
  const thumb = mode === "thumb";
  const brand = useBrandInfo(data.brand);
  const full = useMemo(() => (brand === data.brand ? data : { ...data, brand }), [data, brand]);
  const input = useMemo(() => buildInput(full, mode, !!flipped), [full, mode, flipped]);
  const out = useMemo(() => drawPage(input, full, mode), [input, full, mode]);
  const html = useMemo(() => (noTail ? splitTail(out.html).main : out.html), [noTail, out.html]);
  const kinds = useMemo(() => input.items.map((i) => i.kind), [input]);
  // The animation is pure CSS and starts when the `go` class is added after the page is up. The markup
  // has no `go`, so the card is fully visible if scripts never run. Thumbnails stay still unless asked.
  const play = (autoplay ?? !thumb) && input.design.intro !== 0;

  return (
    <CardBehaviour
      kinds={kinds}
      getTab={(g) => renderTab(input, g)}
      onSave={onSave}
      onItemClick={onItemClick}
      play={play}
      playKey={playKey}
      flipped={flipped}
      contentKey={`${out.wrapClass}|${out.pageVars["--tsr"] ?? ""}|${out.pageVars["--tf"] ?? ""}|${html}`}
      inert={thumb}
    >
      <CardMarkup html={html} pageVars={out.pageVars} fullHeight={fullHeight} thumb={thumb} wrapClass={out.wrapClass} />
    </CardBehaviour>
  );
}
