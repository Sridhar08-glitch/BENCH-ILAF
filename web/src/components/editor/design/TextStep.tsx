"use client";

// The Text step of the design picker: the typeface and the size of the name, title and contact lines.
// The font list shows the owner's own name in every font. The size slider cannot be dragged past the largest size
// that fits the chosen design (measured in the browser, see lib/library/textfit), so no choice here can make the card
// overlap or run off its edge.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Icon } from "@/components/Icon";
import { CardView } from "@/components/card/CardView";
import { hasArabic } from "@/lib/card/bidi";
import { dirOf, type MessageKey } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { refit } from "@/lib/library/enhance";
import { buildInput, drawPage } from "@/lib/library/render";
import {
  FONTS, FONT_FACE, SAMPLE_ARABIC, SAMPLE_LATIN, TEXT_SIZE_DEFAULT, TEXT_SIZE_MAX, TEXT_SIZE_MIN, fontStack, isFontLocked, normalizeFont, type FontGroup, type FontInfo,
} from "@/lib/library/text";
import { maxFitOfHtml } from "@/lib/library/textfit";
import type { CardPageData } from "@/lib/library/types";
import type { Design } from "@/lib/types";
import { Scaled } from "./Preview";
import s from "./design.module.css";

type Base = Omit<CardPageData, "design">;

const GROUP_LABELS: Record<FontGroup, MessageKey> = {
  sans: "editor.fontSans", geometric: "editor.fontGeometric", humanist: "editor.fontHumanist", tech: "editor.fontTech", serif: "editor.fontSerif",
  elegant: "editor.fontElegant", bookish: "editor.fontBookish", display: "editor.fontDisplay", mono: "editor.fontMono", hand: "editor.fontHand",
  script: "editor.fontScript", arabic: "editor.fontArabic",
};

/**
 * The largest size that fits the card as it is drawn now, measured on a hidden copy once the fonts are in. null
 * until the first measurement (the slider then holds to 100%, like the page does before it has measured).
 */
export function useMaxFit(base: Base, d: Design): number | null {
  const [max, setMax] = useState<number | null>(null);
  // The size itself is left out: how large the text may get does not depend on how large it is now.
  const drawn = useMemo(() => {
    const data: CardPageData = { ...base, design: { ...d, size: TEXT_SIZE_DEFAULT } };
    return drawPage(buildInput(data, "preview", false), data, "preview");
  }, [base, d.face, d.colour, d.below, d.photo, d.brand_colors, d.font]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true;
    // Wide fonts change what fits. Measuring makes the browser start loading the fonts it has not got yet, so after
    // each measurement it waits for them and measures again.
    const measure = (again = 0) => {
      if (!live) return;
      setMax(maxFitOfHtml(drawn.html, `${drawn.wrapClass} tx-size`, drawn.pageVars, refit));
      if (document.fonts?.status === "loading" && again < 4) void document.fonts.ready.then(() => measure(again + 1));
    };
    const timer = window.setTimeout(measure, 80);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [drawn]);
  return max;
}

export function TextStep({ base, d, set }: { base: Base; d: Design; set: (p: Partial<Design>) => void }) {
  const { t, locale } = useI18n();
  const max = useMaxFit(base, d);
  const cardLang = base.locale ?? locale;
  const preview = useMemo<CardPageData>(() => ({ ...base, design: { ...d, intro: 0 } }), [base, d]);
  return (
    <div className={s.tools}>
      <div className={s.textPreview} aria-label={t("editor.livePreview")} style={{ pointerEvents: "none" }}>
        <Scaled width={280} ratio={0.72} dir={dirOf(cardLang)}>
          <CardView data={preview} mode="preview" autoplay={false} />
        </Scaled>
      </div>

      <div className={s.count}>{t("editor.fontHead")}</div>
      {isFontLocked(d.face) ? (
        <div className="notice" role="status">
          <Icon name="lock" />
          <div className="grow">
            <b>{t("editor.fontLocked")}</b> {t("editor.fontLockedHint")}
          </div>
        </div>
      ) : (
        <FontList name={base.name} value={normalizeFont(d.font)} onPick={(font) => set({ font })} />
      )}

      <div className={s.count}>{t("editor.sizeHead")}</div>
      <SizeSlider value={d.size} max={max} onChange={(size) => set({ size })} />
    </div>
  );
}

/** One font as a button: the owner's name set in it, and the font's own name beneath. */
function FontCell({ info, text, on, onPick }: { info: FontInfo; text: string; on: boolean; onPick: () => void }) {
  const { t } = useI18n();
  const arabic = info.script === "arabic";
  return (
    <button type="button" className={s.fontcell} aria-pressed={on} onClick={onPick}>
      <span className={s.sample} dir="auto" lang={arabic ? "ar" : undefined} style={{ fontFamily: fontStack(info.key) ?? undefined }}>{text}</span>
      <small dir="ltr">{info.name} &middot; {t(GROUP_LABELS[info.group])}</small>
    </button>
  );
}

function FontList({ name, value, onPick }: { name: string; value: string; onPick: (key: string) => void }) {
  const { t } = useI18n();
  const own = name.trim();
  const latin = FONTS.filter((f) => f.script === "latin");
  const arabic = FONTS.filter((f) => f.script === "arabic");
  return (
    <div className={s.fonts} role="group" aria-label={t("editor.fontHead")}>
      <button type="button" className={s.fontcell} aria-pressed={value === FONT_FACE} onClick={() => onPick(FONT_FACE)}>
        <span className={s.sample} dir="auto">{own || SAMPLE_LATIN}</span>
        <small>{t("editor.fontOwn")}</small>
      </button>
      {latin.map((f) => (
        <FontCell key={f.key} info={f} text={own || SAMPLE_LATIN} on={value === f.key} onPick={() => onPick(f.key)} />
      ))}
      <div className={s.fontsub}>{t("editor.fontArabicHead")}</div>
      {arabic.map((f) => (
        <FontCell key={f.key} info={f} text={own && hasArabic(own) ? own : SAMPLE_ARABIC} on={value === f.key} onPick={() => onPick(f.key)} />
      ))}
    </div>
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const place = (v: number) => (v - TEXT_SIZE_MIN) / (TEXT_SIZE_MAX - TEXT_SIZE_MIN);

/**
 * A drag slider from 60% to 150%. Arrow keys move one percent, Page Up and Page Down ten, Home and End jump to the
 * smallest size and to the largest that fits. The thumb stops at the largest size that fits (`max`), where a marker
 * and a short message say why; the track follows the page direction, so in Arabic 60% is on the right.
 */
export function SizeSlider({ value, max, onChange }: { value: number; max: number | null; onChange: (v: number) => void }) {
  const { t, number, locale } = useI18n();
  const rtl = dirOf(locale) === "rtl";
  const track = useRef<HTMLDivElement>(null);
  const [stopped, setStopped] = useState(false);
  // Until it is measured the slider allows 100%, like a page that has not measured yet.
  const limit = max === null ? TEXT_SIZE_DEFAULT : Math.max(TEXT_SIZE_DEFAULT, max);
  const shown = Math.min(value, TEXT_SIZE_MAX);
  const pct = (v: number) => t("editor.percent", { n: number(v) });

  const apply = (wanted: number) => {
    const v = clamp(Math.round(wanted), TEXT_SIZE_MIN, TEXT_SIZE_MAX);
    const capped = Math.min(v, limit);
    setStopped(v > limit);
    if (capped !== value) onChange(capped);
  };

  const fromPointer = (x: number) => {
    const r = track.current?.getBoundingClientRect();
    if (!r || !r.width) return value;
    const f = clamp((x - r.left) / r.width, 0, 1);
    return TEXT_SIZE_MIN + (rtl ? 1 - f : f) * (TEXT_SIZE_MAX - TEXT_SIZE_MIN);
  };

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.currentTarget.focus();
    apply(fromPointer(e.clientX));
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) apply(fromPointer(e.clientX));
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    // like the browser's own slider: in a right-to-left page the left arrow goes toward the larger size
    const toward = rtl ? "ArrowLeft" : "ArrowRight";
    const away = rtl ? "ArrowRight" : "ArrowLeft";
    let next: number | null = null;
    if (e.key === toward || e.key === "ArrowUp") next = shown + 1;
    else if (e.key === away || e.key === "ArrowDown") next = shown - 1;
    else if (e.key === "PageUp") next = shown + 10;
    else if (e.key === "PageDown") next = shown - 10;
    else if (e.key === "Home") next = TEXT_SIZE_MIN;
    else if (e.key === "End") next = limit;
    if (next === null) return;
    e.preventDefault();
    apply(next);
  };

  const atLimit = max !== null && max < TEXT_SIZE_MAX;
  return (
    <div className={s.size}>
      <div className={s.sizehead}>
        <output className={s.readout} aria-live="off">{pct(shown)}</output>
        <button type="button" className="btn ghost sm" disabled={shown === TEXT_SIZE_DEFAULT} onClick={() => { setStopped(false); onChange(TEXT_SIZE_DEFAULT); }}>{t("editor.sizeReset")}</button>
      </div>
      <div
        ref={track}
        className={s.slider}
        data-rtl={rtl}
        role="slider"
        tabIndex={0}
        aria-label={t("editor.sizeAria")}
        aria-valuemin={TEXT_SIZE_MIN}
        aria-valuemax={TEXT_SIZE_MAX}
        aria-valuenow={shown}
        aria-valuetext={pct(shown)}
        aria-describedby="size-fit-note"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onKeyDown={onKey}
        style={{ ["--p" as string]: place(shown), ["--limit" as string]: place(limit) }}
      >
        <div className={s.rail} />
        <div className={s.blocked} />
        <div className={s.fill} />
        {atLimit && <div className={s.marker} aria-hidden="true" />}
        <div className={s.thumb} />
      </div>
      <div className={s.ends} aria-hidden="true">
        <span>{pct(TEXT_SIZE_MIN)}</span>
        <span>{pct(TEXT_SIZE_MAX)}</span>
      </div>
      <p id="size-fit-note" className={s.fitnote} data-stopped={stopped} role="status" aria-live="polite">
        {max === null ? t("editor.sizeChecking") : atLimit ? t("editor.sizeFit", { n: number(limit) }) : t("editor.sizeFitAll")}
        {stopped ? <> {t("editor.sizeStopped")}</> : null}
        {!stopped && max !== null && shown > limit ? <> {t("editor.sizeHeld", { n: number(limit) })}</> : null}
      </p>
    </div>
  );
}
