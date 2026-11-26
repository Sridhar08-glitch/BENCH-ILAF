"use client";

// What the three tool pages (signature, scan) share: choosing one of the user's cards, and
// the card's colours and company logo, so every tool looks like the card it belongs to.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, type ReactNode } from "react";
import { Empty, ErrorBox, PageHead, SkeletonBlocks } from "@/components/app/ui";
import { useWs } from "@/components/app/WorkspaceContext";
import { shortAddress } from "@/lib/card-address";
import { useCards, useWorkspaceDetail } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n/client";
import { normalizeDesign, resolveColours } from "@/lib/library";
import type { Card, WorkspaceDetail } from "@/lib/types";

export interface ToolColours {
  bg: string;
  bg2: string;
  fg: string;
  acc: string;
  on: string;
}

/** The colours a card is drawn with, and the company's own palette when it has one. */
export function toolColours(card: Card, ws: WorkspaceDetail | undefined): { card: ToolColours; company: ToolColours | null } {
  const brand = ws?.kind === "company" ? ws.brand : null;
  const palette = brand?.palette ?? null;
  const design = normalizeDesign(brand?.lock_design ? brand.design : card.design);
  const r = resolveColours(design, palette);
  return { card: { bg: r.bg, bg2: r.bg2, fg: r.fg, acc: r.acc, on: r.on }, company: palette ? { bg: palette.bg, bg2: palette.bg2, fg: palette.fg, acc: palette.acc, on: palette.on } : null };
}

/** The company logo of a card's workspace, or null (personal cards have none). */
export function companyLogo(ws: WorkspaceDetail | undefined): string | null {
  return ws?.kind === "company" ? ws.brand.logo_url ?? null : null;
}

interface Props {
  title: string;
  sub: string;
  /** Pages that act on one card get it here once it is chosen. */
  children: (card: Card, ws: WorkspaceDetail | undefined, picker: ReactNode) => ReactNode;
}

/** Loads the user's cards, picks the one in the address (?card=) or the first, and draws the page head. */
export function ToolCardPage({ title, sub, children }: Props) {
  const { current } = useWs();
  const { t } = useI18n();
  const cards = useCards(current.id);
  const router = useRouter();
  const param = useSearchParams().get("card");
  const list = useMemo(() => cards.data ?? [], [cards.data]);
  const card = list.find((c) => c.id === param) ?? list[0];
  const ws = useWorkspaceDetail(card?.workspace_id ?? "");
  const picker = useMemo(
    () =>
      list.length > 1 && card ? (
        <label style={{ maxWidth: 420 }}>
          {t("dash.toolCardLabel")}
          <select value={card.id} onChange={(e) => router.replace(`?card=${e.target.value}`)}>
            {list.map((c) => <option key={c.id} value={c.id}>{c.name || t("dash.toolUntitled")} - {shortAddress(c)}</option>)}
          </select>
        </label>
      ) : null,
    [list, card, router, t],
  );
  if (cards.isLoading) return <div className="view"><SkeletonBlocks rows={3} /></div>;
  if (cards.error) return <div className="view"><ErrorBox error={cards.error} onRetry={() => void cards.refetch()} /></div>;
  if (!card) {
    return (
      <div className="view">
        <PageHead title={title} />
        <div className="panel"><Empty title={t("dash.toolNoCard")} action={<Link className="btn sm" href="/app/cards">{t("dash.toolCreate")}</Link>}>{t("dash.toolNoCardText")}</Empty></div>
      </div>
    );
  }
  return (
    <div className="view">
      <PageHead title={title} sub={sub} />
      {children(card, ws.data, picker)}
    </div>
  );
}
