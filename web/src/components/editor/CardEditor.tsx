"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { designsApi } from "@/lib/designs/api";
import { Icon } from "@/components/Icon";
import { SaveSheet } from "@/components/card/SaveSheet";
import { PreviewDock } from "@/components/app/PreviewDock";
import { WalletButton } from "@/components/app/WalletButton";
import { clearDraft } from "@/lib/preview-bridge";
import { Empty, ErrorBox, SkeletonBlocks, UpgradeNotice, useToast } from "@/components/app/ui";
import { CardSwitcher } from "./CardSwitcher";
import { GuidedFlow } from "./GuidedFlow";
import { ExtrasPreview } from "./ExtrasPreview";
import { resolveColours } from "@/lib/library";
import { TourButton } from "@/components/guide/TourButton";
import { announce } from "@/lib/guide/api";
import type { Draft, EditorApi } from "./types";
import { ApiError, api } from "@/lib/api";
import { shortAddress } from "@/lib/card-address";
import { MAX_ITEMS, toApiItems } from "@/lib/card/buttons";
import { normalizeDesign } from "@/lib/library";
import { toCompanyBrand } from "@/lib/library/company/brand";
import { previewFromCard } from "@/lib/card/vcard";
import { keys, useCard, useWorkspaceDetail } from "@/lib/hooks";
import { useFlags } from "@/lib/flags";
import { FREE_ACCESS, buttonsAllLocked, buttonsNeedApproval, fieldWordIn, linkProblem, mandatoryProblem } from "@/lib/ops/fields";
import { useResolvedIcons } from "@/lib/icons-client";
import { apiErrorText, apiFieldText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import { cardLocale, type TFunction } from "@/lib/i18n";
import type { Card } from "@/lib/types";

/** A plain sentence for a rejected save: unsafe links, too many buttons, or the API's own message. */
function saveProblem(e: ApiError, t: TFunction): string {
  const raw = e.field("items");
  const items = apiFieldText(e, "items", t);
  if (raw && items) {
    if (/40|too many|max/i.test(raw)) return t("editor.saveTooMany", { n: MAX_ITEMS });
    if (/company/i.test(raw)) return items;
    return t("editor.saveBadLink", { problem: items });
  }
  const first = Object.keys(e.fields)[0];
  if (first) return t("editor.saveField", { field: first.replace(/_/g, " "), message: apiFieldText(e, first, t) ?? "" });
  return apiErrorText(e, t);
}

export function CardEditor({ id }: { id: string }) {
  const { t } = useI18n();
  const q = useCard(id);
  if (q.isLoading) return <div className="view"><SkeletonBlocks rows={4} /></div>;
  if (q.error) return <div className="view"><ErrorBox error={q.error} onRetry={() => void q.refetch()} /></div>;
  if (!q.data) return <Empty title={t("editor.notFound")} action={<Link className="btn sm" href="/app/cards">{t("editor.backToCards")}</Link>} />;
  return <Loaded key={q.data.id} card={q.data} />;
}

function Loaded({ card }: { card: Card }) {
  const { t, locale, list } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const ws = useWorkspaceDetail(card.workspace_id);
  // The Content tab (sections under the card) follows the page-styles switch; cards keep what they already hold.
  const flags = useFlags(card.workspace_id) as Record<string, boolean>;
  const contentOn = flags.page_styles ?? true;
  const [sheet, setSheet] = useState(false);
  const [photo, setPhoto] = useState(card.photo_url);
  const [cover, setCover] = useState(card.cover_url ?? null);
  const [replay, setReplay] = useState(0);
  const [draft, setDraft] = useState<Draft>(() => ({
    name: card.name, title: card.title, company: card.company, address: card.address, save_contact: card.save_contact,
    language: card.language ?? "auto", vc: card.vc, design: normalizeDesign(card.design), items: card.items.map((i) => ({ ...i })),
  }));
  const [status, setStatus] = useState<"saved" | "saving" | "error">("saved");
  const [saveError, setSaveError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [cardStatus, setCardStatus] = useState(card.status);
  const [publishError, setPublishError] = useState<unknown>(null);
  const [held, setHeld] = useState(false);
  const [issue, setIssue] = useState<string | null>(null);
  const access = card.field_access ?? FREE_ACCESS;
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const pending = useRef<Record<string, unknown>>({});
  const timer = useRef<number | undefined>(undefined);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    const body = pending.current;
    if (Object.keys(body).length === 0) return true;
    pending.current = {};
    setStatus("saving");
    try {
      const c = await api.updateCard(card.id, body);
      qc.setQueryData(keys.card(card.id), c);
      if (c.submitted_for_approval?.length) toast(t("editor.sentForApproval", { fields: list(c.submitted_for_approval.map((f) => fieldWordIn(f, t))) }));
      setSaveError(null);
      setStatus(Object.keys(pending.current).length ? "saving" : "saved");
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.code === "field_locked") {
        // The company does not allow this change: put the card back to what it really holds.
        pending.current = {};
        setDraft((d) => ({ ...d, name: card.name, title: card.title, company: card.company, address: card.address, items: card.items.map((i) => ({ ...i })) }));
        setSaveError(null);
        setStatus("saved");
        toast(apiErrorText(e, t));
        return true;
      }
      pending.current = { ...body, ...pending.current };
      setSaveError(e instanceof ApiError ? e : new ApiError(0, "error", t("editor.couldNotSave")));
      setStatus("error");
      return false;
    }
  }, [card.id, card.name, card.title, card.company, card.address, card.items, qc, toast, t, list]);

  const schedule = useCallback(
    (patch: Record<string, unknown>) => {
      Object.assign(pending.current, patch);
      setStatus("saving");
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), 800);
    },
    [flush],
  );

  // Leaving the editor saves whatever is still waiting and refreshes the card lists.
  useEffect(
    () => () => {
      void flush();
      void qc.invalidateQueries({ queryKey: ["cards"] });
      clearDraft(card.id);
    },
    [flush, qc, card.id],
  );

  const brand = ws.data?.brand;
  const locked = !!(ws.data && ws.data.kind === "company" && brand?.lock_design);

  const update = useCallback(
    (patch: Partial<Draft>) => {
      const safe: Partial<Draft> = { ...patch };
      if (locked) delete safe.design;
      // Company field rules: a locked or approval field is not changed by typing in it.
      for (const f of ["name", "title", "company", "address"] as const) {
        if (f in safe && access[f] !== "free") delete safe[f];
      }
      let holdItems = false;
      if (safe.items) {
        const stop = buttonsAllLocked(access.buttons) ? t("editor.companySetsButtons") : mandatoryProblem(safe.items, draftRef.current.items, access.mandatory_buttons, t);
        if (stop) {
          toast(stop);
          delete safe.items;
        } else {
          const problem = linkProblem(safe.items, access, t);
          setIssue(problem);
          // A problem keeps the change on screen without saving it; approval buttons wait to be sent together.
          holdItems = !!problem || buttonsNeedApproval(access.buttons);
          if (buttonsNeedApproval(access.buttons)) setHeld(true);
        }
      }
      setDraft((d) => ({ ...d, ...safe }));
      const body: Record<string, unknown> = { ...safe };
      if (safe.items) body.items = toApiItems(safe.items);
      if (holdItems) delete body.items;
      if (Object.keys(body).length) schedule(body);
    },
    [locked, schedule, access, toast, t],
  );

  /** Ask for approval of one field value. Returns a sentence when it failed. */
  const requestChange = useCallback(
    async (field: "name" | "title" | "company" | "address", value: string): Promise<string | null> => {
      try {
        const c = await api.updateCard(card.id, { [field]: value });
        qc.setQueryData(keys.card(card.id), c);
        toast(t("editor.requestSent"));
        return null;
      } catch (e) {
        return e instanceof ApiError ? saveProblem(e, t) : t("editor.requestFailed");
      }
    },
    [card.id, qc, toast, t],
  );

  const withdraw = useCallback(
    async (id: string) => {
      try {
        await api.withdrawChange(id);
        void qc.invalidateQueries({ queryKey: keys.card(card.id) });
        toast(t("editor.withdrawn"));
      } catch (e) {
        toast(apiErrorText(e, t, "editor.withdrawFailed"));
      }
    },
    [card.id, qc, toast, t],
  );

  const sendItems = useCallback(async () => {
    try {
      const c = await api.updateCard(card.id, { items: toApiItems(draftRef.current.items) });
      qc.setQueryData(keys.card(card.id), c);
      setDraft((d) => ({ ...d, items: c.items.map((i) => ({ ...i })) }));
      setHeld(false);
      setIssue(null);
      toast(c.submitted_for_approval?.length ? t("editor.itemsSentApproval") : t("editor.buttonsSaved"));
    } catch (e) {
      setSaveError(e instanceof ApiError ? e : new ApiError(0, "error", t("editor.sendFailed")));
      setStatus("error");
    }
  }, [card.id, qc, toast, t]);

  const discardItems = useCallback(() => {
    setDraft((d) => ({ ...d, items: card.items.map((i) => ({ ...i })) }));
    setHeld(false);
    setIssue(null);
  }, [card.items]);

  const icons = useResolvedIcons(draft.items);
  const companyBrand = useMemo(() => (brand && ws.data?.kind === "company" ? toCompanyBrand(brand) : null), [brand, ws.data?.kind]);
  const design = normalizeDesign(locked && brand ? brand.design : draft.design);

  const ed: EditorApi = {
    card: { ...card, photo_url: photo, cover_url: cover },
    draft,
    update,
    patchNow: schedule,
    locked,
    icons,
    setPhoto: (url) => setPhoto(url),
    setCover: (url) => setCover(url),
    canCover: true,
    brand: companyBrand,
    replay: () => setReplay((n) => n + 1),
    access,
    pending: card.pending_changes ?? [],
    requestChange,
    withdraw,
    itemsHeld: held,
    sendItems,
    discardItems,
    itemsIssue: issue,
  };

  // The preview draws the card in the card's own language, or in the dashboard's when the card follows the visitor.
  const cardLang = cardLocale(draft.language ?? "auto", locale);
  const ownFaces = useQuery({ queryKey: ["custom-faces", card.workspace_id], queryFn: () => designsApi.faces(card.workspace_id), staleTime: 60000 });
  const customFace = ownFaces.data?.find((f) => f.id === design.custom_face) ?? null;
  const view = useMemo(
    () => ({
      customFace,
      name: draft.name, title: draft.title, company: draft.company, address: draft.address, photoUrl: photo, coverUrl: cover, publicUrl: card.public_url, saveContact: draft.save_contact,
      design,
      items: draft.items.map((it, i) => ({ ...it, res: icons[i] })),
      brand: companyBrand,
      locale: cardLang,
    }),
    [draft, photo, cover, design, icons, companyBrand, card.public_url, cardLang, customFace],
  );

  const contact = useMemo(
    () => previewFromCard({ name: draft.name, title: draft.title, company: draft.company, address: draft.address, items: draft.items, vc: draft.vc, cardUrl: card.public_url }),
    [draft, card.public_url],
  );

  async function togglePublish() {
    setBusy(true);
    setPublishError(null);
    try {
      if (!(await flush())) throw new ApiError(0, "error", t("editor.fixFirst"));
      const c = cardStatus === "published" ? await api.unpublishCard(card.id) : await api.publishCard(card.id);
      qc.setQueryData(keys.card(card.id), c);
      setCardStatus(c.status);
      toast(c.status === "published" ? t("editor.cardLive") : t("editor.cardUnpublished"));
      if (c.status === "published") announce("card_published");
    } catch (e) {
      setPublishError(e);
    } finally {
      setBusy(false);
    }
  }

  const live = cardStatus === "published";

  return (
    <div className="split">
      <div className="formcol">
        <div className="top">
          <div>
            <h1 dir="auto">{draft.name || t("editor.untitled")}</h1>
            <p className="sub">
              <Link href="/app/cards" style={{ fontWeight: 700 }}>{t("editor.allCards")}</Link> &middot; <span className="ltr">{shortAddress(card)}</span>
            </p>
          </div>
          <div className="row">
            <span className={`pill ${live ? "ok" : cardStatus === "suspended" ? "bad" : ""}`}>{live ? t("editor.statusPublished") : cardStatus === "suspended" ? t("editor.statusSuspended") : t("editor.statusDraft")}</span>
            <span className={`pill ${status === "error" ? "bad" : status === "saving" ? "warn" : "ok"} saved`} role="status" aria-live="polite">
              <Icon name={status === "saving" ? "clock" : status === "error" ? "alert" : "check"} size="s" />
              {status === "saving" ? t("editor.saving") : status === "error" ? t("editor.notSaved") : t("editor.allSaved")}
            </span>
            <TourButton />
            <Link className="btn ghost" href={`/app/share?card=${card.id}`} data-guide="editor-qr"><Icon name="qr" size="s" />{t("editor.qrShare")}</Link>
            <WalletButton cardId={card.id} published={live} />
            <button type="button" className={live ? "btn ghost" : "btn"} data-guide="editor-publish" disabled={busy || cardStatus === "suspended"} onClick={() => void togglePublish()}>
              <Icon name="check" size="s" />{live ? t("editor.unpublish") : t("editor.publish")}
            </button>
          </div>
        </div>

        {ws.data?.kind === "personal" && <CardSwitcher card={card} onLabel={(label) => schedule({ label })} />}

        {status === "error" && saveError && (
          saveError.code === "plan_limit" || saveError.code === "subscription_required" ? (
            <UpgradeNotice error={saveError} />
          ) : (
            <div className="notice bad" role="alert">
              <Icon name="alert" />
              <div className="grow">
                <b>{saveError.code === "validation_error" ? t("editor.errValidation") : t("editor.errSave")}</b>
                {saveProblem(saveError, t)}
                <div style={{ marginBlockStart: 8 }}><button type="button" className="btn ghost sm" onClick={() => void flush()}>{t("common.retry")}</button></div>
              </div>
            </div>
          )
        )}
        {publishError !== null && <ErrorBox error={publishError} />}
        {(card.pending_changes?.length ?? 0) > 0 && (
          <div className="notice warn" role="status">
            <Icon name="clock" />
            <div className="grow">
              <b>{t("editor.waitingTitle")}</b>
              {t("editor.waitingText", { fields: list((card.pending_changes ?? []).map((p) => fieldWordIn(p.field, t))) })}
              <div className="row" style={{ marginBlockStart: 8 }}>
                {card.pending_changes?.map((p) => (
                  <button key={p.id} type="button" className="btn ghost sm" onClick={() => void withdraw(p.id)}>{t("editor.withdrawRequest", { field: fieldWordIn(p.field, t) })}</button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="panel card">
          <GuidedFlow ed={ed} extras={contentOn} live={live} busy={busy} onPublish={() => void togglePublish()} />
        </div>
      </div>

      <PreviewDock
        data={view}
        shareKey={card.id}
        playKey={replay}
        onReplay={() => setReplay((n) => n + 1)}
        onSave={() => setSheet(true)}
        overlay={sheet ? <SaveSheet position="absolute" contact={contact} photoUrl={photo} onAdd={() => undefined} onClose={() => setSheet(false)} /> : null}
        hint={shortAddress(card)}
        extra={<ExtrasPreview card={ed.card} name={draft.name} language={draft.language} pageVars={resolveColours(design, companyBrand?.palette ?? null).pageVars} />}
      />
    </div>
  );
}
