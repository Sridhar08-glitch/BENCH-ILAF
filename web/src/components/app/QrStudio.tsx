"use client";

// The styled QR code of one card: the saved look, the picture drawn from it, the scan check, the downloads and the panel that edits the look.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/Icon";
import { Switch } from "@/components/app/Switch";
import { toolColours } from "@/components/app/ToolCard";
import { APP_NAME } from "@/lib/config";
import { qrModules } from "@/lib/card/qr";
import { useI18n } from "@/lib/i18n/client";
import { tk, type MessageKey, type TFunction } from "@/lib/i18n";
import { imageDataUrl, readStoredStyle, saveBlob, svgToPng } from "@/lib/qr/client";
import { qrSvg } from "@/lib/qr/render";
import {
  DEFAULT_STYLE, DOT_SHAPES, EYE_SHAPES, FRAME_STYLES, LOGO_KINDS, MAX_LABEL, MAX_QUIET, SIZES, eccFor, presetsFor, scanGuard, styleStorageKey,
  type Guard, type GuardIssue, type QrStyle,
} from "@/lib/qr/style";
import type { Card, WorkspaceDetail } from "@/lib/types";

function logoUrlFor(kind: QrStyle["logo"], card: Card, ws: WorkspaceDetail | undefined): string | null {
  if (kind === "photo") return card.photo_url;
  if (ws?.kind !== "company") return null;
  return kind === "company" ? ws.brand.logo_url ?? null : kind === "symbol" ? ws.brand.symbol_url ?? null : null;
}

export interface QrStudio {
  style: QrStyle;
  setStyle: (patch: Partial<QrStyle>) => void;
  reset: () => void;
  /** The picture to show, as a data address; null while it cannot be drawn. */
  dataUrl: string | null;
  guard: Guard;
  size: number;
  setSize: (n: number) => void;
  logoMissing: boolean;
  logoTooBig: boolean;
  /** The saved look has been read (before that the default look is shown). */
  ready: boolean;
  /** The picture in the middle, as a data address, once loaded. */
  logoHref: string | null;
  download: (format: "png" | "svg", base: string) => Promise<void>;
}

/** One card's styled QR: `text` is what a phone camera opens. */
export function useQrStudio(card: Card, ws: WorkspaceDetail | undefined, text: string): QrStudio {
  const [style, setStyleState] = useState<QrStyle>(DEFAULT_STYLE);
  const [loaded, setLoaded] = useState(false);
  const [size, setSize] = useState<number>(1024);
  const [logoHref, setLogoHref] = useState<string | null>(null);
  const [logoMissing, setLogoMissing] = useState(false);

  useEffect(() => {
    setStyleState(readStoredStyle(card.id));
    setLoaded(true);
  }, [card.id]);
  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(styleStorageKey(card.id), JSON.stringify(style));
    } catch {
      /* private mode: the look just is not remembered */
    }
  }, [style, loaded, card.id]);

  const logoUrl = style.print ? null : logoUrlFor(style.logo, card, ws);
  useEffect(() => {
    setLogoHref(null);
    setLogoMissing(false);
    if (!logoUrl) return;
    let live = true;
    void imageDataUrl(logoUrl).then((d) => {
      if (!live) return;
      setLogoHref(d);
      setLogoMissing(d === null);
    });
    return () => {
      live = false;
    };
  }, [logoUrl]);

  // With a logo the code needs the highest error correction; a text too long for that is drawn without the logo.
  const built = useMemo(() => {
    const withLogo = !!logoHref && !style.print && style.logo !== "none";
    let modules = qrModules(text, eccFor(style, withLogo));
    let usedLogo = withLogo;
    if (!modules && withLogo) {
      modules = qrModules(text, "M");
      usedLogo = false;
    }
    if (!modules) return null;
    return { ...qrSvg(modules, style, { logoHref: usedLogo ? logoHref : null, width: size }), logoTooBig: withLogo && !usedLogo };
  }, [text, style, logoHref, size]);

  const dataUrl = built ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(built.svg)}` : null;
  const bytes = new TextEncoder().encode(text).length;
  const guard = useMemo(() => scanGuard(style, { bytes }), [style, bytes]);

  const setStyle = useCallback((patch: Partial<QrStyle>) => setStyleState((s) => ({ ...s, ...patch })), []);
  const reset = useCallback(() => setStyleState(DEFAULT_STYLE), []);

  const download = useCallback(
    async (format: "png" | "svg", base: string) => {
      if (!built) throw new Error("not drawn");
      if (format === "svg") return saveBlob(new Blob([built.svg], { type: "image/svg+xml" }), `${base}.svg`);
      saveBlob(await svgToPng(built.svg, built.width, built.height), `${base}.png`);
    },
    [built],
  );

  return { style, setStyle, reset, dataUrl, guard, size, setSize, logoMissing, logoTooBig: built?.logoTooBig ?? false, ready: loaded, logoHref, download };
}

const DOT_NAMES: Record<(typeof DOT_SHAPES)[number], MessageKey> = {
  square: tk("growth.qrDotsSquare"), rounded: tk("growth.qrDotsRounded"), dots: tk("growth.qrDotsDots"), classy: tk("growth.qrDotsClassy"),
};
const EYE_NAMES: Record<(typeof EYE_SHAPES)[number], MessageKey> = { square: tk("growth.qrEyesSquare"), rounded: tk("growth.qrEyesRounded"), leaf: tk("growth.qrEyesLeaf") };
const FRAME_NAMES: Record<(typeof FRAME_STYLES)[number], MessageKey> = {
  none: tk("growth.qrFrameNone"), box: tk("growth.qrFrameBox"), bar: tk("growth.qrFrameBar"), bartop: tk("growth.qrFrameBartop"),
  pill: tk("growth.qrFramePill"), corners: tk("growth.qrFrameCorners"), badge: tk("growth.qrFrameBadge"),
};
const LOGO_NAMES: Record<(typeof LOGO_KINDS)[number], MessageKey> = {
  none: tk("growth.qrLogoNone"), company: tk("growth.qrLogoCompany"), symbol: tk("growth.qrLogoSymbol"), photo: tk("growth.qrLogoPhoto"),
};

/** The words for one scan-check finding. */
export function guardText(i: GuardIssue, t: TFunction, number: (n: number) => string): string {
  switch (i.code) {
    case "low_contrast": return t("growth.qrGuardLowContrast", { ratio: number(i.ratio) });
    case "light_on_dark": return t("growth.qrGuardLightOnDark");
    case "eye_contrast": return t("growth.qrGuardEye", { ratio: number(i.ratio) });
    case "quiet_none": return t("growth.qrGuardQuietNone");
    case "quiet_small": return t("growth.qrGuardQuietSmall");
    case "frame_contrast": return t("growth.qrGuardFrame", { ratio: number(i.ratio) });
    case "dense_dots": return t("growth.qrGuardDense");
  }
}

function Choice<T extends string>({ label, value, options, onPick }: { label: string; value: T; options: { k: T; name: string }[]; onPick: (k: T) => void }) {
  return (
    <div>
      <div className="hint" style={{ marginBlockEnd: 6, fontWeight: 700 }}>{label}</div>
      <div role="group" aria-label={label} className="seg" style={{ flexWrap: "wrap", alignSelf: "flex-start" }}>
        {options.map((o) => <button key={o.k} type="button" aria-pressed={value === o.k} onClick={() => onPick(o.k)}>{o.name}</button>)}
      </div>
    </div>
  );
}

/** The style controls and the scan check. */
export function QrStylePanel({ card, ws, studio }: { card: Card; ws: WorkspaceDetail | undefined; studio: QrStudio }) {
  const { t, number } = useI18n();
  const { style, setStyle, guard } = studio;
  const cols = toolColours(card, ws);
  const presets = presetsFor(cols.card, cols.company);
  const company = ws?.kind === "company" ? ws.brand : null;
  const available = LOGO_KINDS.filter((k) => k === "none" || (k === "photo" ? !!card.photo_url : k === "company" ? !!company?.logo_url : !!company?.symbol_url));
  const off = style.print;

  return (
    <div className="panel card" data-guide="qr-style">
      <div className="head">
        <h2><span className="chip"><Icon name="palette" size="s" /></span>{t("growth.qrStyleTitle")}</h2>
        <button type="button" className="btn ghost sm" onClick={studio.reset}>{t("growth.qrReset")}</button>
      </div>
      <p className="hint" style={{ marginBlockStart: 0 }}>{t("growth.qrStyleHint")}</p>

      <div className={`notice ${guard.level === "ok" ? "" : guard.level === "warn" ? "warn" : "bad"}`} role={guard.level === "bad" ? "alert" : "status"}>
        <Icon name={guard.level === "ok" ? "check" : "alert"} />
        <div className="grow">
          {guard.level === "ok" ? t("growth.qrGuardOk", { ratio: number(guard.ratio) }) : guard.issues.map((i) => <div key={i.code}>{guardText(i, t, number)}</div>)}
        </div>
      </div>

      <div className="toggle first">
        <div>{t("growth.qrPrint")}<small>{t("growth.qrPrintHint")}</small></div>
        <Switch checked={style.print} onChange={(on) => setStyle({ print: on })} label={t("growth.qrPrint")} />
      </div>

      <div className="pane" style={{ opacity: off ? 0.5 : 1 }} aria-disabled={off}>
        <fieldset disabled={off} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 14 }}>
          <Choice label={t("growth.qrDots")} value={style.dots} options={DOT_SHAPES.map((k) => ({ k, name: t(DOT_NAMES[k]) }))} onPick={(dots) => setStyle({ dots })} />
          <Choice label={t("growth.qrEyes")} value={style.eyes} options={EYE_SHAPES.map((k) => ({ k, name: t(EYE_NAMES[k]) }))} onPick={(eyes) => setStyle({ eyes })} />

          <div>
            <div className="hint" style={{ marginBlockEnd: 6, fontWeight: 700 }}>{t("growth.qrPresets")}</div>
            <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
              {presets.map((p) => (
                <button key={p.id} type="button" className="btn ghost sm" aria-pressed={style.fg.toLowerCase() === p.fg.toLowerCase() && style.bg.toLowerCase() === p.bg.toLowerCase()} onClick={() => setStyle({ fg: p.fg.toUpperCase(), bg: p.bg.toUpperCase(), eyeFg: "" })}>
                  <span aria-hidden style={{ width: 14, height: 14, borderRadius: 4, background: p.fg, border: "1px solid var(--line)", display: "inline-block", marginInlineEnd: 6 }} />
                  {t(p.nameKey, { app: APP_NAME })}
                </button>
              ))}
            </div>
          </div>
          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            <label style={{ minWidth: 110 }}>{t("growth.qrFg")}<input type="color" value={style.fg} onChange={(e) => setStyle({ fg: e.target.value.toUpperCase() })} /></label>
            <label style={{ minWidth: 110 }}>{t("growth.qrBg")}<input type="color" value={style.bg} onChange={(e) => setStyle({ bg: e.target.value.toUpperCase() })} /></label>
            <label style={{ minWidth: 110 }}>
              {t("growth.qrEyeColour")}
              <input type="color" value={style.eyeFg || style.fg} onChange={(e) => setStyle({ eyeFg: e.target.value.toUpperCase() })} />
              {style.eyeFg && <button type="button" className="btn ghost sm" onClick={() => setStyle({ eyeFg: "" })}>{t("growth.qrEyeSame")}</button>}
            </label>
          </div>

          <label style={{ maxWidth: 320 }}>
            {t("growth.qrLogo")}
            <select value={available.includes(style.logo) ? style.logo : "none"} onChange={(e) => setStyle({ logo: e.target.value as QrStyle["logo"] })}>
              {available.map((k) => <option key={k} value={k}>{t(LOGO_NAMES[k])}</option>)}
            </select>
          </label>
          {style.logo !== "none" && <div className="hint">{t("growth.qrLogoNote")}</div>}
          {studio.logoMissing && <div className="hint" role="status">{t("growth.qrLogoMissing")}</div>}
          {studio.logoTooBig && <div className="hint" role="status">{t("growth.qrLogoTooBig")}</div>}

          <label style={{ maxWidth: 320 }}>
            {t("growth.qrQuiet", { n: number(style.quiet) })}
            <input type="range" min={0} max={MAX_QUIET} step={1} value={style.quiet} onChange={(e) => setStyle({ quiet: Number(e.target.value) })} />
          </label>

          <label style={{ maxWidth: 320 }}>
            {t("growth.qrFrame")}
            <select value={style.frame} onChange={(e) => setStyle({ frame: e.target.value as QrStyle["frame"], label: style.label || t("growth.qrLabelDefault") })}>
              {FRAME_STYLES.map((k) => <option key={k} value={k}>{t(FRAME_NAMES[k])}</option>)}
            </select>
          </label>
          {style.frame !== "none" && (
            <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
              <label style={{ flex: 1, minWidth: 200 }}>{t("growth.qrLabel")}<input value={style.label} maxLength={MAX_LABEL} dir="auto" onChange={(e) => setStyle({ label: e.target.value })} /></label>
              <label style={{ minWidth: 110 }}>
                {t("growth.qrFrameColour")}
                <input type="color" value={style.frameColor || style.fg} onChange={(e) => setStyle({ frameColor: e.target.value.toUpperCase() })} />
                {style.frameColor && <button type="button" className="btn ghost sm" onClick={() => setStyle({ frameColor: "" })}>{t("growth.qrFrameSame")}</button>}
              </label>
            </div>
          )}
        </fieldset>
      </div>

      <label style={{ maxWidth: 320 }}>
        {t("growth.qrSize")}
        <select value={studio.size} onChange={(e) => studio.setSize(Number(e.target.value))}>
          {SIZES.map((n) => <option key={n} value={n}>{t("growth.qrSizePx", { n: number(n) })}</option>)}
        </select>
      </label>
    </div>
  );
}
