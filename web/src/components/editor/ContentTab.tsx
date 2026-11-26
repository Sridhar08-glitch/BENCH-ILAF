"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/Icon";
import { allowedExtras } from "@/lib/ops/fields";
import { Switch } from "@/components/app/Switch";
import { ErrorBox, UpgradeNotice, useToast } from "@/components/app/ui";
import { MAX_SECTIONS, addableKinds } from "@/components/card/sections/helpers";
import { ApiError, isUpgradeError } from "@/lib/api";
import { contentApi, contentKeys, defaultSectionData, type CardSection, type EditorSectionData } from "@/lib/api-content";
import { usePlans, useWorkspaceDetail } from "@/lib/hooks";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import { tk, type MessageKey, type TFunction } from "@/lib/i18n";
import type { SectionKind } from "@/lib/public-api";
import type { Plan, Subscription } from "@/lib/types";
import { BookingForm } from "./content/BookingForm";
import { EventForm } from "./content/EventForm";
import { GalleryForm } from "./content/GalleryForm";
import { HoursForm } from "./content/HoursForm";
import { MapForm } from "./content/MapForm";
import { ProductsForm } from "./content/ProductsForm";
import { TeamForm } from "./content/TeamForm";
import { VideoForm } from "./content/VideoForm";
import type { EditorApi } from "./types";
import c from "./content/content.module.css";

/** Rich content belongs to the paid plans: a live subscription to a plan with a price. Unknown (still loading) counts as allowed,
 * so the tab never flashes a lock; the API has the last word and answers with the upgrade error. */
export function richPagesAllowed(sub: Subscription | undefined, plans: Plan[] | undefined): boolean {
  if (!sub || !plans) return true;
  if (!sub.live) return false;
  const plan = plans.find((p) => p.code === sub.plan_code);
  return plan ? plan.price_minor > 0 : true;
}

/** The free plan: a personal workspace with no plan yet, or inside its 7-day trial. */
export const FREE_LIMIT = 50;
export function isFreePlan(kind: string | undefined, sub: Subscription | undefined): boolean {
  if (kind !== "personal" || !sub) return false;
  return sub.plan_code === null || sub.plan_code === "free";
}

const KIND_ICON: Record<SectionKind, string> = { video: "youtube", products: "gem", hours: "clock", booking: "check", team: "users", gallery: "camera", event: "star", map: "pin" };
const KIND_NAME: Record<SectionKind, MessageKey> = {
  video: tk("content.kindVideo"), products: tk("content.kindProducts"), hours: tk("content.kindHours"), booking: tk("content.kindBooking"),
  team: tk("content.kindTeam"), gallery: tk("content.kindGallery"), event: tk("content.kindEvent"), map: tk("content.kindMap"),
};
const KIND_HINT: Record<SectionKind, MessageKey> = {
  video: tk("content.kindVideoHint"), products: tk("content.kindProductsHint"), hours: tk("content.kindHoursHint"), booking: tk("content.kindBookingHint"),
  team: tk("content.kindTeamHint"), gallery: tk("content.kindGalleryHint"), event: tk("content.kindEventHint"), map: tk("content.kindMapHint"),
};

/** The name of a block kind in the page's language. */
export function kindName(kind: SectionKind, t: TFunction): string {
  return t(KIND_NAME[kind]);
}

/** The sections after one is moved a step up or down. */
export function movedSections(list: readonly CardSection[], id: string, dir: -1 | 1): CardSection[] {
  const out = list.slice();
  const i = out.findIndex((s) => s.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= out.length) return out;
  [out[i], out[j]] = [out[j], out[i]];
  return out.map((s, idx) => ({ ...s, order: idx }));
}

export function ContentTab({ ed }: { ed: EditorApi }) {
  const { card } = ed;
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const ws = useWorkspaceDetail(card.workspace_id);
  const plans = usePlans();
  const locked = !richPagesAllowed(ws.data?.subscription, plans.data);
  const q = useQuery({ queryKey: contentKeys.sections(card.id), queryFn: () => contentApi.sections(card.id) });
  const sections = (q.data ?? []).slice().sort((a, b) => a.order - b.order);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const timers = useRef<Record<string, number>>({});
  const pending = useRef<Record<string, EditorSectionData[SectionKind]>>({});

  // The menu's Orders and Bookings entries follow what the cards have, so any change to the blocks refreshes them.
  const setList = useCallback((list: CardSection[]) => {
    qc.setQueryData(contentKeys.sections(card.id), list);
    void qc.invalidateQueries({ queryKey: ["commerce-access"] });
  }, [qc, card.id]);
  const fail = useCallback(
    (e: unknown) => {
      setError(e);
      setSaving("idle");
      if (!isUpgradeError(e)) toast(apiErrorText(e, t, "content.saveFailed"));
    },
    [toast, t],
  );

  const flush = useCallback(
    async (id: string) => {
      window.clearTimeout(timers.current[id]);
      const data = pending.current[id];
      if (!data) return;
      delete pending.current[id];
      setSaving("saving");
      try {
        const saved = await contentApi.updateSection(card.id, id, { data });
        const current = qc.getQueryData<CardSection[]>(contentKeys.sections(card.id)) ?? [];
        // A newer edit may be waiting: keep the screen's data, take the rest from the answer.
        setList(current.map((s) => (s.id === id ? ({ ...saved, data: pending.current[id] ?? saved.data } as CardSection) : s)));
        setError(null);
        setSaving(Object.keys(pending.current).length ? "saving" : "saved");
      } catch (e) {
        fail(e);
      }
    },
    [card.id, qc, setList, fail],
  );

  // Leaving the tab saves whatever is still waiting.
  useEffect(() => {
    const ids = timers.current;
    return () => {
      for (const id of Object.keys(ids)) void flush(id);
    };
  }, [flush]);

  const change = (id: string, data: EditorSectionData[SectionKind]) => {
    pending.current[id] = data;
    setList(sections.map((s) => (s.id === id ? ({ ...s, data } as CardSection) : s)));
    setSaving("saving");
    window.clearTimeout(timers.current[id]);
    timers.current[id] = window.setTimeout(() => void flush(id), 800);
  };

  async function toggle(s: CardSection, on: boolean) {
    setList(sections.map((x) => (x.id === s.id ? ({ ...x, on } as CardSection) : x)));
    try {
      await contentApi.updateSection(card.id, s.id, { on });
      setError(null);
    } catch (e) {
      setList(sections);
      fail(e);
    }
  }

  async function move(id: string, dir: -1 | 1) {
    const next = movedSections(sections, id, dir);
    setList(next);
    try {
      await contentApi.reorderSections(card.id, next.map((s) => s.id));
      setError(null);
    } catch (e) {
      setList(sections);
      fail(e);
    }
  }

  async function remove(s: CardSection) {
    if (!window.confirm(t("content.removeConfirm", { name: kindName(s.kind, t) }))) return;
    try {
      await contentApi.deleteSection(card.id, s.id);
      setList(sections.filter((x) => x.id !== s.id));
      if (open === s.id) setOpen(null);
      setError(null);
      toast(t("content.removed"));
    } catch (e) {
      fail(e);
    }
  }

  async function add(kind: SectionKind) {
    if (sections.length >= MAX_SECTIONS) return toast(t("content.maxSections", { n: MAX_SECTIONS }));
    let zone = "UTC";
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone || zone;
    } catch {
      /* keep UTC */
    }
    try {
      const created = await contentApi.createSection(card.id, kind, defaultSectionData(kind, zone));
      setList([...sections, created as CardSection]);
      setOpen(created.id);
      setError(null);
    } catch (e) {
      fail(e);
    }
  }

  // Only the extras the company lets this person add; ones they already have of another kind stay listed, marked as hidden.
  const allowed = allowedExtras(ed.access);
  const addable = addableKinds(sections).filter((k) => allowed.includes(k));
  const roomLeft = sections.length < MAX_SECTIONS;

  return (
    <div className="pane" data-guide="content-tab">
      <p className="hint">{t("content.intro")}</p>
      {locked && (
        <div className="notice warn" role="status">
          <Icon name="crown" />
          <div className="grow">
            <b>{t("content.lockedTitle")}</b>
            {t("content.lockedText")}
            <div style={{ marginBlockStart: 8 }}><Link className="btn sm" href="/app/billing">{t("dash.uiSeePlans")}</Link></div>
          </div>
        </div>
      )}
      {error !== null && (isUpgradeError(error) ? <UpgradeNotice error={error as ApiError} /> : <ErrorBox error={error} />)}
      {q.isLoading && <div className="skeleton" style={{ height: 64 }} />}
      {q.error && <ErrorBox error={q.error} onRetry={() => void q.refetch()} />}

      {!q.isLoading && sections.length === 0 && <p className="hint">{t("content.noSections")}</p>}
      <div className={c.rows}>
        {sections.map((s, i) => {
          const isOpen = open === s.id;
          return (
            <div key={s.id}>
              <div className={`${c.row}${isOpen ? ` ${c.open}` : ""}${s.on ? "" : ` ${c.off}`}`}>
                <span className={c.chip} aria-hidden="true"><Icon name={KIND_ICON[s.kind]} size="s" /></span>
                <button type="button" className={c.name} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : s.id)}>
                  <b>{kindName(s.kind, t)}</b>
                  <small dir="auto">{allowed.includes(s.kind) ? s.data.title || t("content.noTitle") : t("content.notAllowed")}</small>
                </button>
                <Switch checked={s.on} disabled={locked} label={t("content.showOnPage")} onChange={(on) => void toggle(s, on)} />
                <div className={c.tools}>
                  <button type="button" className={c.iconbtn} disabled={locked || i === 0} aria-label={t("content.moveUp")} onClick={() => void move(s.id, -1)}><Icon name="down" size="s" style={{ transform: "rotate(180deg)" }} /></button>
                  <button type="button" className={c.iconbtn} disabled={locked || i === sections.length - 1} aria-label={t("content.moveDown")} onClick={() => void move(s.id, 1)}><Icon name="down" size="s" /></button>
                  <button type="button" className={c.iconbtn} disabled={locked} aria-label={t("content.remove")} onClick={() => void remove(s)}><Icon name="trash" size="s" /></button>
                </div>
              </div>
              {isOpen && (
                <div className={c.form}>
                  <SectionForm ed={ed} section={s} disabled={locked} onChange={(data) => change(s.id, data)} onError={fail} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className={c.status} role="status" aria-live="polite">
        {saving === "saving" && <><Icon name="clock" size="s" />{t("content.saving")}</>}
        {saving === "saved" && <><Icon name="check" size="s" />{t("content.saved")}</>}
      </div>

      {addable.length > 0 && (
        <div className="pane" style={{ gap: 8 }}>
          <div className="sechead"><Icon name="plus" size="s" />{t("content.addSection")}</div>
          {!roomLeft && <p className="hint">{t("content.maxSections", { n: MAX_SECTIONS })}</p>}
          <div className={c.addgrid}>
            {addable.map((k) => (
              <button key={k} type="button" className={c.add} disabled={locked || !roomLeft} onClick={() => void add(k)}>
                <span className={c.chip} aria-hidden="true"><Icon name={KIND_ICON[k]} size="s" /></span>
                <span style={{ minWidth: 0 }}><b>{t(KIND_NAME[k])}</b><small>{t(KIND_HINT[k])}</small></span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SectionForm({ ed, section, disabled, onChange, onError }: { ed: EditorApi; section: CardSection; disabled: boolean; onChange: (data: EditorSectionData[SectionKind]) => void; onError: (e: unknown) => void }) {
  switch (section.kind) {
    case "video": return <VideoForm ed={ed} section={section} disabled={disabled} onChange={onChange} onError={onError} />;
    case "products": return <ProductsForm ed={ed} section={section} disabled={disabled} onChange={onChange} />;
    case "hours": return <HoursForm ed={ed} section={section} disabled={disabled} onChange={onChange} />;
    case "booking": return <BookingForm ed={ed} section={section} disabled={disabled} onChange={onChange} />;
    case "team": return <TeamForm ed={ed} section={section} disabled={disabled} onChange={onChange} />;
    case "gallery": return <GalleryForm ed={ed} section={section} disabled={disabled} onChange={onChange} onError={onError} />;
    case "event": return <EventForm ed={ed} section={section} disabled={disabled} onChange={onChange} />;
    case "map": return <MapForm ed={ed} section={section} disabled={disabled} onChange={onChange} />;
    default: return null;
  }
}
