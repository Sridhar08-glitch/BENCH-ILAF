"use client";

// The live card preview used beside every editor. On a laptop it is a panel that stays in view while the form
// scrolls, with the whole card scaled to fit it. On a phone it is a floating "Preview" button that opens a
// full-screen sheet. Both can open the same card, as it is right now, in a new tab.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { CardView, type CardViewData } from "@/components/card/CardView";
import { CardTail } from "@/components/card/CardTail";
import { useI18n } from "@/lib/i18n/client";
import { previewHref, publishDraft } from "@/lib/preview-bridge";
import { fitScale } from "@/lib/preview-fit";
import s from "./preview.module.css";

/** Width the stacked page is drawn at before it is scaled to fit the panel. */
const PAGE_W = 408;

/** Whether a media query matches; undefined until the browser has told us. */
function useMedia(query: string): boolean | undefined {
  const [m, setM] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    const q = window.matchMedia(query);
    const on = () => setM(q.matches);
    on();
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, [query]);
  return m;
}

interface Props {
  data: CardViewData;
  /** The key the preview tab reads this draft from, and the page it opens. */
  shareKey: string;
  /** The page that shows the preview in its own tab. */
  href?: string;
  /** Plays the opening again (the editor owns the counter). */
  playKey: number;
  onReplay: () => void;
  onSave?: () => void;
  /** Drawn on top of the screen (the save-contact sheet). */
  overlay?: ReactNode;
  /** A row above the card (the sample employee chooser). */
  top?: ReactNode;
  hint?: string;
  /** Drawn under the card inside the same screen (the extras of the card). */
  extra?: ReactNode;
  /** Raise the floating button above a bar that sticks to the bottom of the page (the brand steps). */
  lift?: boolean;
}

/** The card inside its frame, scaled so the whole page fits the panel without an inner scrollbar. */
function Fitted({ fit, children }: { fit: boolean; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const width = PAGE_W;

  useLayoutEffect(() => {
    const b = box.current;
    const i = inner.current;
    if (!b || !i) return;
    const measure = () => setScale(fit ? fitScale(b.clientWidth, b.clientHeight, i.offsetWidth, i.offsetHeight) : 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(b);
    ro.observe(i);
    return () => ro.disconnect();
  }, [fit]);

  return (
    <div ref={box} className={fit ? s.fitbox : s.freebox}>
      <div
        ref={inner}
        className={fit ? s.fitinner : s.freeinner}
        style={{ width, transform: fit ? `translateX(-50%) scale(${scale})` : undefined }}
      >
        {children}
      </div>
    </div>
  );
}

export function PreviewDock({ data, shareKey, href, playKey, onReplay, onSave, overlay, top, hint, lift, extra }: Props) {
  const { t } = useI18n();
  const narrow = useMedia("(max-width: 980px)");
  const [open, setOpen] = useState(false);
  const [shared, setShared] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const target = href ?? previewHref(shareKey);

  // Once the preview tab has been opened, every change goes to it as well.
  useEffect(() => {
    if (shared) publishDraft(shareKey, data);
  }, [shared, shareKey, data]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const flip = useCallback(() => frame.current?.querySelector<HTMLElement>(".cfl .card")?.click(), []);

  function openTab() {
    publishDraft(shareKey, data);
    setShared(true);
    window.open(target, "_blank", "noopener");
  }

  const card = (fit: boolean) => (
    <div ref={frame} className={s.frame}>
      <Fitted fit={fit}>
        <div className="device" style={{ maxWidth: "none" }}>
          <div className="scr">
            <CardView data={data} mode="preview" playKey={playKey} onSave={onSave} noTail />
            {extra}
            <CardTail data={data} />
            {overlay}
          </div>
        </div>
      </Fitted>
    </div>
  );

  const controls = (
    <div className={s.controls}>
      <div className={s.actions}>
        <button type="button" className="btn ghost sm" onClick={flip}><Icon name="tap" size="s" />{t("dash.previewFlip")}</button>
        <button type="button" className="btn ghost sm" onClick={onReplay}><Icon name="eye" size="s" />{t("dash.previewPlay")}</button>
        <button type="button" className="btn ghost sm" onClick={openTab}><Icon name="arrow" size="s" />{t("dash.previewNewTab")}</button>
      </div>
    </div>
  );

  return (
    <>
      <aside className="dockcol" data-guide="preview" aria-label={t("dash.previewAria")}>
        <div className={`panel ${s.dock}`}>
          {controls}
          {top}
          {narrow === false && card(true)}
          {hint && <div className="hint">{hint}</div>}
        </div>
      </aside>

      {narrow === true && (
        <>
          <button type="button" className={`${s.fab} ${lift ? s.lift : ""}`} onClick={() => setOpen(true)} aria-haspopup="dialog">
            <Icon name="eye" size="s" />{t("dash.previewButton")}
          </button>
          {open && (
            <div className={s.sheet} role="dialog" aria-modal="true" aria-label={t("dash.previewAria")}>
              <div className={s.sheethead}>
                <b>{t("dash.previewSheetTitle")}</b>
                <button type="button" className="btn ghost sm" onClick={openTab}><Icon name="arrow" size="s" />{t("dash.previewNewTab")}</button>
                <button type="button" className="btn sm" onClick={() => setOpen(false)}>{t("common.close")}</button>
              </div>
              <div className={s.sheetbody}>
                <div className={s.controls}>
                  <div className={s.actions}>
                    <button type="button" className="btn ghost sm" onClick={flip}><Icon name="tap" size="s" />{t("dash.previewFlip")}</button>
                    <button type="button" className="btn ghost sm" onClick={onReplay}><Icon name="eye" size="s" />{t("dash.previewPlay")}</button>
                  </div>
                </div>
                {top}
                {card(false)}
                {hint && <div className="hint" style={{ textAlign: "center" }}>{hint}</div>}
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
