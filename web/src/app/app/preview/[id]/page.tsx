"use client";

import { use, useEffect, useMemo, useState } from "react";
import { LivePage } from "@/components/card/LivePage";
import type { CardViewData } from "@/components/card/CardView";
import { Empty, ErrorBox, SkeletonBlocks } from "@/components/app/ui";
import { useWs } from "@/components/app/WorkspaceContext";
import { brandCardData } from "@/lib/brand/sample";
import { fullBrand } from "@/lib/brand/state";
import { useQuery } from "@tanstack/react-query";
import { designsApi } from "@/lib/designs/api";
import { useCard, useWorkspaceDetail } from "@/lib/hooks";
import { useResolvedIcons } from "@/lib/icons-client";
import { normalizeDesign } from "@/lib/library";
import { toCompanyBrand } from "@/lib/library/company/brand";
import { ExtrasPreview } from "@/components/editor/ExtrasPreview";
import { resolveColours } from "@/lib/library";
import { readDraft, subscribeDraft } from "@/lib/preview-bridge";
import { useI18n } from "@/lib/i18n/client";
import { cardLocale, type Locale } from "@/lib/i18n";
import type { Card } from "@/lib/types";

/** The editor's unsaved draft (kept live while the editor tab is open), or the saved version when opened directly. */
function useDraft(id: string): CardViewData | null {
  const [draft, setDraft] = useState<CardViewData | null>(null);
  useEffect(() => {
    setDraft(readDraft<CardViewData>(id));
    return subscribeDraft<CardViewData>(id, setDraft);
  }, [id]);
  return draft;
}

export default function PreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const draft = useDraft(id);
  return id === "brand" ? <BrandPreview draft={draft} /> : <CardPreview id={id} draft={draft} />;
}

function BrandPreview({ draft }: { draft: CardViewData | null }) {
  const { current } = useWs();
  const { locale } = useI18n();
  const ws = useWorkspaceDetail(current.id);
  const saved = useMemo(() => {
    if (!ws.data) return null;
    const b = fullBrand(ws.data.brand);
    const company = ws.data.kind === "company";
    const name = b.company_name || ws.data.name;
    return brandCardData(b, name, "amira", company ? toCompanyBrand({ ...b, company_name: name }) : null, locale);
  }, [ws.data, locale]);
  const data = draft ?? saved;
  if (!data) return ws.error ? <ErrorBox error={ws.error} /> : <SkeletonBlocks rows={3} />;
  // The brand sample has no language of its own: it is drawn in the dashboard's.
  return <LivePage data={{ ...data, locale: data.locale ?? locale }} />;
}

function CardPreview({ id, draft }: { id: string; draft: CardViewData | null }) {
  const { t, locale } = useI18n();
  const q = useCard(id);
  const card = q.data;
  const ws = useWorkspaceDetail(card?.workspace_id ?? "");
  const icons = useResolvedIcons(card?.items ?? []);
  const ownFaces = useQuery({ queryKey: ["custom-faces", card?.workspace_id ?? ""], queryFn: () => designsApi.faces(card!.workspace_id), enabled: !!card && ws.data?.kind === "company" });
  const saved = useMemo(() => {
    if (!card) return null;
    const view = savedView(card, ws.data?.kind === "company" ? ws.data.brand : null, icons, locale);
    return { ...view, customFace: ownFaces.data?.find((f) => f.id === view.design.custom_face) ?? null };
  }, [card, ws.data, icons, locale, ownFaces.data]);
  const data = draft ?? saved;
  if (!data) {
    if (q.error) return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />;
    return q.isLoading ? <SkeletonBlocks rows={3} /> : <Empty title={t("editor.notFound")} />;
  }
  const extra = card ? <ExtrasPreview card={card} name={data.name} language={card.language ?? "auto"} pageVars={resolveColours(data.design, data.brand?.palette ?? null).pageVars} /> : null;
  return <LivePage data={data} extra={extra} />;
}

function savedView(card: Card, brand: Parameters<typeof toCompanyBrand>[0], icons: ReturnType<typeof useResolvedIcons>, dashboardLocale: Locale): CardViewData {
  const company = toCompanyBrand(brand);
  const locked = !!(brand && "lock_design" in brand && (brand as { lock_design?: boolean }).lock_design);
  const design = normalizeDesign(locked && brand ? (brand as { design?: unknown }).design : card.design);
  return {
    name: card.name, title: card.title, company: card.company, address: card.address, photoUrl: card.photo_url, coverUrl: card.cover_url ?? null,
    publicUrl: card.public_url, saveContact: card.save_contact, design,
    items: card.items.map((it, i) => ({ ...it, res: icons[i] })),
    brand: company,
    locale: cardLocale(card.language ?? "auto", dashboardLocale),
  };
}
