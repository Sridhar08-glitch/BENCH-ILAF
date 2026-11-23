"use client";

// The company brand page's panels: logo and symbol files, how the logo is shown, brand colours, and how the brand appears on the cards
// (colours and logo, a background, a logo pattern or a company template). Each panel works on the page's working
// copy of the brand; pictures are uploaded at once, everything else is saved with the page's Save button.
import { BrandCustomPanel } from "@/components/designs/BrandCustomPanel";
import { useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { ToggleRow } from "@/components/app/Switch";
import { ApiError, api } from "@/lib/api";
import { prepareArt, prepareLogo } from "@/lib/brand/logo-file";
import { brandProblem } from "@/lib/brand/errors";
import { startColours, withColours, withMode, type FullBrand } from "@/lib/brand/state";
import { BG_SAMPLES, TEMPLATE_SAMPLES, ZONES, sampleBgUri, scrimFor, templateInfo, templateUri } from "@/lib/library/company/artwork";
import { sampleColours } from "@/lib/library/company/brand";
import { paletteCandidates, readLogoPixels, type PaletteCandidate } from "@/lib/brand/palette-from-logo";
import { COMPANY_COLOUR } from "@/lib/library";
import { derivePalette, normHex, okHex } from "@/lib/library/company/colour";
import { FACE_H } from "@/lib/library/company/marks";
import type { CompanyBrand } from "@/lib/library/types";
import type { ArtworkMode, BrandColours, TemplateZone } from "@/lib/types";
import { COMPANY_NAME } from "@/lib/config";
import { useI18n } from "@/lib/i18n/client";
import { IMAGE_ACCEPT, isAllowedImage } from "@/lib/images";
import { tk, type I18n, type MessageKey } from "@/lib/i18n";
import s from "./brand.module.css";

export type Update = (fn: (b: FullBrand) => FullBrand, dirty?: boolean) => void;

interface Common {
  b: FullBrand;
  update: Update;
  wsId: string;
  toast: (m: string) => void;
}

function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className={`seg ${s.wrapseg}`} role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={String(v)} type="button" aria-pressed={v === value} onClick={() => onChange(v)}>{text}</button>
      ))}
    </div>
  );
}

const MAX_PICK = 12 * 1024 * 1024;

function problem(e: unknown, fallback: string, t: I18n["t"]): string {
  return e instanceof ApiError ? brandProblem(e, t) : fallback;
}

// ---- logo and symbol

function PictureSlot({ title, hint, url, busy, onPick, onRemove, dark }: { title: string; hint: string; url: string | null | undefined; busy: boolean; onPick: (f: File) => void; onRemove?: () => void; dark?: boolean }) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className={s.fld}>
      <span className={s.lab}>{title}</span>
      <div className={s.slot}>
        <div className={`${s.thumb} ${dark ? s.dark : ""}`}>{url ? <img src={url} alt={title} /> : <small>{t("brand.picNone")}</small>}</div>
        <div>
          <input ref={input} type="file" hidden accept={IMAGE_ACCEPT} onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ""; }} />
          <div className="row">
            <button type="button" className="btn ghost sm" disabled={busy} onClick={() => input.current?.click()}><Icon name="upload" size="s" />{busy ? t("brand.uploading") : url ? t("brand.replace") : t("common.upload")}</button>
            {url && onRemove && <button type="button" className="btn ghost sm" disabled={busy} onClick={onRemove}>{t("common.remove")}</button>}
          </div>
          <div className="hint" style={{ marginBlockStart: 6 }}>{hint}</div>
        </div>
      </div>
    </div>
  );
}

export function LogoFilesPanel({ b, update, wsId, toast, simple }: Common & { simple?: boolean }) {
  const { t, number } = useI18n();
  const [busy, setBusy] = useState<"" | "logo" | "symbol">("");

  async function pick(slot: "logo" | "symbol", f: File) {
    if (!isAllowedImage(f)) return toast(t("common.useImage"));
    if (f.size > MAX_PICK) return toast(t("brand.logoTooLarge", { size: number(12) }));
    setBusy(slot);
    try {
      const blob = await prepareLogo(f);
      if (slot === "logo") {
        const r = await api.uploadLogo(wsId, blob);
        update((x) => ({ ...x, logo_url: r.logo_url }), false);
      } else {
        const r = await api.uploadBrandPicture(wsId, "symbol", blob);
        update((x) => ({ ...x, symbol_url: r.symbol_url }), false);
      }
      toast(slot === "logo" ? t("brand.logoUpdated") : t("brand.symbolUpdated"));
    } catch (e) {
      toast(problem(e, t("brand.logoReadFailed"), t));
    } finally {
      setBusy("");
    }
  }

  async function remove(slot: "logo" | "symbol") {
    setBusy(slot);
    try {
      if (slot === "logo") {
        await api.deleteLogo(wsId);
        update((x) => ({ ...x, logo_url: null }), false);
      } else {
        await api.deleteBrandPicture(wsId, "symbol");
        update((x) => ({ ...x, symbol_url: null }), false);
      }
    } catch (e) {
      toast(problem(e, t("brand.removeFailed"), t));
    } finally {
      setBusy("");
    }
  }

  const hasMark = !!(b.logo_url || b.symbol_url);
  return (
    <div className="pane">
      <PictureSlot title={t("brand.slotLogo")} hint={t("brand.slotLogoHint")} url={b.logo_url} busy={busy === "logo"} onPick={(f) => void pick("logo", f)} onRemove={() => void remove("logo")} />
      {!simple && <PictureSlot title={t("brand.slotSymbol")} hint={t("brand.slotSymbolHint")} url={b.symbol_url} busy={busy === "symbol"} onPick={(f) => void pick("symbol", f)} onRemove={() => void remove("symbol")} />}
      {!hasMark && !simple && <div className={s.note}>{t("brand.noLogoNote")}</div>}
    </div>
  );
}

/** How the logo is shown on the cards: what it shows, where it goes, its corner and the backing behind it. */
export function LogoLookPanel({ b, update }: Pick<Common, "b" | "update">) {
  const { t } = useI18n();
  const hasMark = !!(b.logo_url || b.symbol_url);
  return (
    <div className="pane">
      {!hasMark && <div className={s.note}>{t("brand.noLogoYet")}</div>}
      <div className={s.fld}>
        <span className={s.lab}>{t("brand.whatLogoShows")}</span>
        <Seg label={t("brand.logoStyle")} value={b.logo_display} onChange={(v) => update((x) => ({ ...x, logo_display: v }))} options={[["auto", t("brand.logoAuto")], ["full", t("brand.logoFull")], ["symbol", t("brand.logoSymbol")], ["symbol_name", t("brand.logoSymbolName")]]} />
      </div>
      <ToggleRow first title={t("brand.showNameBeside")} checked={b.show_company_name} onChange={(v) => update((x) => ({ ...x, show_company_name: v }))} />
      <div className={s.grid2}>
        <div className={s.fld}>
          <span className={s.lab}>{t("brand.whereItGoes")}</span>
          <Seg label={t("brand.whereLogoGoes")} value={b.logo_placement} onChange={(v) => update((x) => ({ ...x, logo_placement: v }))} options={[["both", t("brand.placeBoth")], ["card", t("brand.placeCard")], ["above", t("brand.placeAbove")]]} />
        </div>
        <div className={s.fld} style={{ opacity: b.logo_placement === "above" ? 0.5 : 1 }}>
          <span className={s.lab}>{t("brand.cornerOfCard")}</span>
          <Seg label={t("brand.logoCorner")} value={b.logo_corner} onChange={(v) => update((x) => ({ ...x, logo_corner: v }))} options={[["auto", t("brand.cornerAuto")], ["tl", t("brand.cornerTl")], ["tr", t("brand.cornerTr")], ["bl", t("brand.cornerBl")], ["br", t("brand.cornerBr")]]} />
        </div>
      </div>
      <div className={s.fld}>
        <span className={s.lab}>{t("brand.backingBehind")}</span>
        <Seg label={t("brand.logoBacking")} value={b.logo_chip} onChange={(v) => update((x) => ({ ...x, logo_chip: v }))} options={[["auto", t("brand.chipAuto")], ["always", t("brand.chipAlways")], ["never", t("brand.chipNever")], ["white", t("brand.chipWhite")], ["black", t("brand.chipBlack")]]} />
        <span className={s.note}>{t("brand.chipNote")}</span>
      </div>
    </div>
  );
}

// ---- brand colours

function ColourInput({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  const { t } = useI18n();
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? value.toUpperCase();
  return (
    <div className={s.fld}>
      <span className={s.lab}>{label}</span>
      <div className={s.cin}>
        <input type="color" aria-label={t("brand.colourPicker", { label })} value={value} onChange={(e) => onChange(normHex(e.target.value).toLowerCase())} />
        <input
          type="text" className="ltr" aria-label={t("brand.colourCode", { label })} value={shown} maxLength={7} spellCheck={false}
          onChange={(e) => { setText(e.target.value); if (okHex(e.target.value)) onChange(normHex(e.target.value).toLowerCase()); }}
          onBlur={() => setText(null)}
        />
      </div>
    </div>
  );
}

function RatioPill({ v, min }: { v: number; min: number }) {
  const { t, number } = useI18n();
  const ratio = number(v, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return <span className={`pill ${v >= min ? "ok" : "warn"}`}>{v >= min ? t("brand.ratioReadable", { ratio }) : t("brand.ratioCheck", { ratio })}</span>;
}

/** "Suggest colours from my logo": up to three palettes read from the logo, each shown on a small sample card; one click applies one. */
function LogoSuggestions({ b, update }: Pick<Common, "b" | "update">) {
  const { t } = useI18n();
  const [list, setList] = useState<PaletteCandidate[] | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "none" | "failed">("idle");
  if (!b.logo_url) return <div className="hint">{t("cardx.suggestNeedsLogo")}</div>;
  const logo = b.logo_url;

  async function suggest() {
    setState("busy");
    try {
      const found = paletteCandidates(await readLogoPixels(logo));
      setList(found);
      setState(found.length ? "idle" : "none");
    } catch {
      setList(null);
      setState("failed");
    }
  }

  const apply = (c: PaletteCandidate) =>
    update((x) => withColours({ ...x, design: x.design.colour === 0 ? { ...x.design, colour: COMPANY_COLOUR } : x.design }, { primary: c.primary, accent: c.accent, mode: c.mode }));

  return (
    <div className="pane" style={{ gap: 10 }}>
      <div>
        <button type="button" className="btn ghost sm" disabled={state === "busy"} onClick={() => void suggest()}>
          <Icon name="palette" size="s" />{state === "busy" ? t("cardx.suggesting") : t("cardx.suggest")}
        </button>
      </div>
      {state === "none" && <div className="hint" role="status">{t("cardx.suggestNone")}</div>}
      {state === "failed" && <div className="hint" role="alert">{t("cardx.suggestFailed")}</div>}
      {list && list.length > 0 && (
        <div role="group" aria-label={t("cardx.suggestions")} style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
          {list.map((c, i) => {
            const p = c.derived.pal;
            return (
              <div key={`${c.primary}${c.accent}${c.mode}`} className="pane" style={{ gap: 6 }}>
                <div aria-hidden="true" style={{ background: p.bg, color: p.fg, borderRadius: 12, padding: 10, display: "grid", gap: 6, border: "1px solid rgba(128,128,128,.25)" }}>
                  <b dir="auto" style={{ fontSize: 13, overflowWrap: "anywhere" }}>{b.company_name || COMPANY_NAME}</b>
                  <span style={{ background: p.bg2, borderRadius: 6, height: 8, width: "70%" }} />
                  <span style={{ background: p.acc, color: p.on, borderRadius: 999, padding: "4px 10px", fontSize: 11, fontWeight: 700, justifySelf: "start" }}>{t("cardx.sampleButton")}</span>
                </div>
                <span className="hint">{t("cardx.option", { n: i + 1 })} &middot; {c.mode === "brand" ? t("brand.cardBrand") : c.mode === "light" ? t("brand.cardLight") : t("brand.cardDark")}</span>
                <button type="button" className="btn sm" onClick={() => apply(c)} aria-label={t("cardx.useOption", { n: i + 1 })}>{t("cardx.use")}</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ColoursPanel({ b, update }: Common) {
  const { t } = useI18n();
  const on = !!b.palette;
  const c = startColours(b);
  const d = derivePalette(c.primary, c.accent, c.mode);
  const setC = (patch: Partial<BrandColours>) => update((x) => withColours(x, { ...startColours(x), ...patch }));
  return (
    <div className="pane">
      <ToggleRow
        first title={t("brand.useCompanyColours")} hint={t("brand.useCompanyColoursHint")}
        checked={on}
        onChange={(v) => update((x) => (v ? withColours({ ...x, design: x.design.colour === 0 ? { ...x.design, colour: COMPANY_COLOUR } : x.design }, startColours(x)) : withColours(x, null)))}
      />
      <LogoSuggestions b={b} update={update} />
      <div className="pane" style={{ opacity: on ? 1 : 0.55 }}>
        <div className={s.cols}>
          <ColourInput label={t("brand.primaryColour")} value={c.primary} onChange={(v) => setC({ primary: v })} />
          <ColourInput label={t("brand.accentColour")} value={c.accent} onChange={(v) => setC({ accent: v })} />
        </div>
        <div className={s.fld}>
          <span className={s.lab}>{t("brand.cardIs")}</span>
          <Seg label={t("brand.cardColourMode")} value={c.mode} onChange={(v) => setC({ mode: v })} options={[["brand", t("brand.cardBrand")], ["light", t("brand.cardLight")], ["dark", t("brand.cardDark")]]} />
        </div>
        <div className={s.palette} title={t("brand.paletteTitle")} aria-label={t("brand.paletteAria")}>
          {[d.pal.bg, d.pal.bg2, d.pal.fg, d.pal.acc, d.pal.on].map((x, i) => <i key={i} style={{ background: x }} />)}
        </div>
        <div className={s.checks} role="group" aria-label={t("brand.readabilityCheck")}>
          <div className={s.check}><span>{t("brand.checkText")}</span><RatioPill v={d.ratios.text} min={4.5} /></div>
          <div className={s.check}><span>{t("brand.checkAccent")}</span><RatioPill v={d.ratios.acc} min={4.5} /></div>
          <div className={s.check}><span>{t("brand.checkOnAccent")}</span><RatioPill v={d.ratios.on} min={3} /></div>
        </div>
        {d.adjusted && <div className={s.note}>{t("brand.adjustedNote")}</div>}
        {d.close && <div className={s.note}>{t("brand.closeNote")}</div>}
      </div>
    </div>
  );
}

// ---- how the brand appears

const MODES: [ArtworkMode | "custom", MessageKey, MessageKey][] = [
  ["none", tk("brand.modeColours"), tk("brand.modeColoursText")],
  ["background", tk("brand.modeBackground"), tk("brand.modeBackgroundText")],
  ["pattern", tk("brand.modePattern"), tk("brand.modePatternText")],
  ["template", tk("brand.modeTemplate"), tk("brand.modeTemplateText")],
  ["custom", tk("brand.modeCustom"), tk("brand.modeCustomText")],
];

function presetDiagram(k: TemplateZone) {
  const pr = ZONES[k];
  const W = 70;
  const H = 40;
  const u = W / 100;
  const rect = (o: { x: number; y?: number; b?: number }, fill: string, w: number, h: number) => {
    const y = o.y != null ? o.y : FACE_H - (o.b ?? 0) - h;
    return <rect x={(o.x * u).toFixed(1)} y={(y * u).toFixed(1)} width={(w * u).toFixed(1)} height={(h * u).toFixed(1)} rx="1.5" fill={fill} />;
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
      <rect width={W} height={H} rx="4" fill="#E9E9EC" />
      {pr.band != null && <rect y={(pr.band * u).toFixed(1)} width={W} height={(H - pr.band * u).toFixed(1)} fill="#B7B7BF" />}
      <circle cx={((pr.ph.x + pr.ph.s / 2) * u).toFixed(1)} cy={((pr.ph.y + pr.ph.s / 2) * u).toFixed(1)} r={((pr.ph.s / 2) * u).toFixed(1)} fill="#7C8BA1" />
      {rect({ x: pr.tx.x, y: pr.tx.y }, "#222", pr.tx.w * 0.7, 7)}
      {rect(pr.ct, "#777", pr.ct.w * 0.8, 8)}
      {pr.qr && rect(pr.qr, "#111", pr.qr.s, pr.qr.s)}
    </svg>
  );
}

export function LookPanel({ b, update, wsId, toast, measured, panel, setPanel }: Common & { measured: CompanyBrand | null; panel: ArtworkMode | "custom"; setPanel: (p: ArtworkMode | "custom") => void }) {
  const { t, number } = useI18n();
  const art = b.artwork;
  const { prim, acc } = sampleColours(b.colours);
  const [busy, setBusy] = useState("");
  const bgIn = useRef<HTMLInputElement>(null);
  const frontIn = useRef<HTMLInputElement>(null);
  const backIn = useRef<HTMLInputElement>(null);

  const setArt = (fn: (a: FullBrand["artwork"]) => void, dirty = true) =>
    update((x) => {
      const a = structuredClone(x.artwork);
      fn(a);
      return { ...x, artwork: a };
    }, dirty);

  async function uploadArt(slot: "background" | "template-front" | "template-back", f: File) {
    if (!isAllowedImage(f)) return toast(t("common.useImage"));
    if (f.size > MAX_PICK) return toast(t("brand.artTooLarge", { size: number(12) }));
    setBusy(slot);
    try {
      const blob = await prepareArt(f);
      const r = await api.uploadBrandPicture(wsId, slot, blob);
      if (slot === "background") {
        update((x) => {
          const y = { ...x, background_url: r.background_url };
          y.artwork = { ...y.artwork, background: { ...y.artwork.background, kind: "upload", sample: null } };
          return y;
        }, true);
      } else if (slot === "template-front") {
        update((x) => ({ ...x, template_front_url: r.template_front_url, artwork: { ...x.artwork, template: { ...x.artwork.template, kind: "upload", sample: null } } }), true);
      } else {
        update((x) => ({ ...x, template_back_url: r.template_back_url }), false);
      }
      toast(t("brand.artUploaded"));
    } catch (e) {
      toast(problem(e, t("brand.artReadFailed"), t));
    } finally {
      setBusy("");
    }
  }

  async function removeBg() {
    setBusy("background");
    try {
      await api.deleteBrandPicture(wsId, "background");
      update((x) => ({ ...x, background_url: null, artwork: { ...x.artwork, background: { ...x.artwork.background, kind: "sample", sample: "geo" } } }), true);
    } catch (e) {
      toast(problem(e, t("brand.removeFailed"), t));
    } finally {
      setBusy("");
    }
  }

  async function removeTemplate() {
    setBusy("template");
    try {
      await Promise.all([api.deleteBrandPicture(wsId, "template-front"), api.deleteBrandPicture(wsId, "template-back")]);
      update((x) => ({ ...x, template_front_url: null, template_back_url: null, artwork: { ...x.artwork, template: { ...x.artwork.template, kind: "sample", sample: "harbor" } } }), true);
    } catch (e) {
      toast(problem(e, t("brand.removePicturesFailed"), t));
    } finally {
      setBusy("");
    }
  }

  const bgPicker = (
    <>
      <div className={s.samples} role="group" aria-label={t("brand.sampleBackgrounds")}>
        {BG_SAMPLES.map((x) => (
          <button
            key={x.id} type="button" className={s.sample} aria-pressed={art.background.kind === "sample" && art.background.sample === x.id}
            style={{ backgroundImage: `url("${sampleBgUri(x.id, prim, acc)}")` }}
            onClick={() => setArt((a) => { a.background = { ...a.background, kind: "sample", sample: x.id }; })}
          ><span>{x.name}</span></button>
        ))}
      </div>
      <div className="row">
        <input ref={bgIn} type="file" hidden accept={IMAGE_ACCEPT} onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadArt("background", f); e.target.value = ""; }} />
        <button type="button" className="btn ghost sm" disabled={busy === "background"} onClick={() => bgIn.current?.click()}><Icon name="upload" size="s" />{busy === "background" ? t("brand.uploading") : t("brand.uploadOwnPicture")}</button>
        {art.background.kind === "upload" && <button type="button" className="btn ghost sm" onClick={() => void removeBg()}>{t("brand.removePicture")}</button>}
      </div>
      <div className={s.fld}>
        <span className={s.lab}>{t("brand.bgStrength")} <b>{number(art.background.strength)}%</b></span>
        <input className={s.range} type="range" min={0} max={100} value={art.background.strength} aria-label={t("brand.bgStrength")} onChange={(e) => setArt((a) => { a.background.strength = Number(e.target.value); })} />
        <span className={s.note}>{t("brand.bgStrengthNote")}</span>
      </div>
      {bgChecks()}
    </>
  );

  function bgChecks() {
    const pal = b.palette;
    const info = measured?.info?.bg;
    if (!pal || !info) return null;
    const sc = scrimFor(pal, info, art.background.strength);
    return (
      <div className={s.checks} role="group" aria-label={t("brand.readabilityOver")}>
        <div className={s.check}><span>{t("brand.checkTextOverBg")}</span><RatioPill v={sc.text} min={4.5} /></div>
        <div className={s.check}><span>{t("brand.checkAccentOverBg")}</span><RatioPill v={sc.acc} min={3} /></div>
        {sc.raised && <div className={s.note}>{t("brand.scrimRaised", { percent: number(Math.round(sc.a * 100)) })}</div>}
        <div className={s.note}>{t("brand.thinEdgeNote")}</div>
      </div>
    );
  }

  const tpl = art.template;
  const tinfo = b.palette || measured?.info?.front ? templateInfo(tpl.zone, tpl.text_colour, measured?.info?.front, measured?.info?.back) : null;
  const light = /^#[0-9a-f]{6}$/i.test(tpl.text_colour) ? (tpl.text_colour.toLowerCase() === "#101114" ? "dark" : "light") : "auto";

  return (
    <div className="pane">
      <div className={s.modes} role="group" aria-label={t("brand.howAppear")}>
        {MODES.map(([k, name, text]) => (
          <button
            key={k} type="button" className={s.mode} aria-pressed={panel === k}
            onClick={() => { setPanel(k); if (k !== "custom") update((x) => withMode(x, k as ArtworkMode)); }}
          ><b>{t(name)}</b><span>{t(text, { company: COMPANY_NAME })}</span></button>
        ))}
      </div>

      {panel === "none" && <div className={s.note}>{t("brand.noneNote")}</div>}

      {panel === "background" && <div className="sub"><h3>{t("brand.bgTitle")}</h3><span className={s.note}>{t("brand.bgNote")}</span>{bgPicker}</div>}

      {panel === "pattern" && (
        <div className="sub">
          <h3>{t("brand.patternTitle")}</h3>
          <span className={s.note}>{t("brand.patternNote")}</span>
          <div className={s.grid2}>
            <div className={s.fld}><span className={s.lab}>{t("brand.size")}</span><Seg label={t("brand.patternSize")} value={art.pattern.size} onChange={(v) => setArt((a) => { a.pattern.size = v; })} options={[["s", t("brand.sizeSmall")], ["m", t("brand.sizeMedium")], ["l", t("brand.sizeLarge")]]} /></div>
            <div className={s.fld}><span className={s.lab}>{t("brand.spacing")}</span><Seg label={t("brand.patternSpacing")} value={art.pattern.spacing} onChange={(v) => setArt((a) => { a.pattern.spacing = v; })} options={[["tight", t("brand.spacingTight")], ["normal", t("brand.spacingNormal")], ["wide", t("brand.spacingWide")]]} /></div>
            <div className={s.fld}><span className={s.lab}>{t("brand.angle")}</span><Seg label={t("brand.patternAngle")} value={art.pattern.angle} onChange={(v) => setArt((a) => { a.pattern.angle = v; })} options={[[0, `${number(0)}°`], [-15, `${number(-15)}°`], [-30, `${number(-30)}°`]]} /></div>
          </div>
          <div className={s.fld}>
            <span className={s.lab}>{t("brand.opacity")} <b>{number(art.pattern.opacity)}%</b></span>
            <input className={s.range} type="range" min={5} max={60} value={art.pattern.opacity} aria-label={t("brand.patternOpacity")} onChange={(e) => setArt((a) => { a.pattern.opacity = Number(e.target.value); })} />
            <span className={s.note}>{t("brand.opacityNote")}</span>
          </div>
          <ToggleRow title={t("brand.alsoBackground")} hint={t("brand.alsoBackgroundHint")} checked={art.pattern.combine_with_background}
            onChange={(v) => setArt((a) => { a.pattern.combine_with_background = v; if (v && a.background.kind === "none") a.background = { ...a.background, kind: "sample", sample: "geo" }; })} />
          {art.pattern.combine_with_background && bgPicker}
        </div>
      )}

      {panel === "template" && (
        <div className="sub">
          <h3>{t("brand.tplTitle")}</h3>
          <span className={s.note}>{t("brand.tplNote")}</span>
          <div className={s.tplgrid} role="group" aria-label={t("brand.sampleTemplates")}>
            {TEMPLATE_SAMPLES.map((x) => (
              <button key={x.id} type="button" className={s.tpl} aria-pressed={tpl.kind === "sample" && tpl.sample === x.id}
                onClick={() => setArt((a) => { a.template = { ...a.template, kind: "sample", sample: x.id, zone: x.zone }; })}>
                <img alt="" src={templateUri(x.id, "front")} />{x.name}
              </button>
            ))}
            {tpl.kind === "upload" && b.template_front_url && (
              <button type="button" className={s.tpl} aria-pressed="true"><img alt="" src={b.template_front_url} />{t("brand.yourArtwork")}</button>
            )}
          </div>
          <div className="row">
            <input ref={frontIn} type="file" hidden accept={IMAGE_ACCEPT} onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadArt("template-front", f); e.target.value = ""; }} />
            <input ref={backIn} type="file" hidden accept={IMAGE_ACCEPT} onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadArt("template-back", f); e.target.value = ""; }} />
            <button type="button" className="btn ghost sm" disabled={busy === "template-front"} onClick={() => frontIn.current?.click()}><Icon name="upload" size="s" />{busy === "template-front" ? t("brand.uploading") : t("brand.uploadFront")}</button>
            <button type="button" className="btn ghost sm" disabled={busy === "template-back" || !b.template_front_url} onClick={() => backIn.current?.click()}><Icon name="upload" size="s" />{busy === "template-back" ? t("brand.uploading") : t("brand.uploadBack")}</button>
            {(b.template_front_url || b.template_back_url) && <button type="button" className="btn ghost sm" disabled={busy === "template"} onClick={() => void removeTemplate()}>{t("brand.removeUploads")}</button>}
          </div>
          <span className={s.note}>{t("brand.tplSizeNote")}</span>
          <div className={s.fld}>
            <span className={s.lab}>{t("brand.whereDetailsGo")}</span>
            <div className={s.zones} role="group" aria-label={t("brand.zonePlacement")}>
              {(["A", "B", "C", "D"] as TemplateZone[]).map((k) => (
                <button key={k} type="button" className={s.zone} aria-pressed={tpl.zone === k} onClick={() => setArt((a) => { a.template.zone = k; })}>
                  {presetDiagram(k)}<span><b>{k}</b> {ZONES[k].name}</span>
                </button>
              ))}
            </div>
          </div>
          <div className={s.grid2}>
            <div className={s.fld}><span className={s.lab}>{t("brand.textColour")}</span>
              <Seg label={t("brand.tplTextColour")} value={light} onChange={(v) => setArt((a) => { a.template.text_colour = v === "auto" ? "auto" : v === "light" ? "#ffffff" : "#101114"; })} options={[["auto", t("brand.textAuto")], ["light", t("brand.textLight")], ["dark", t("brand.textDark")]]} />
            </div>
            <div className={s.fld}><span className={s.lab}>{t("brand.textSize")}</span>
              <Seg label={t("brand.tplTextSize")} value={tpl.text_size} onChange={(v) => setArt((a) => { a.template.text_size = v; })} options={[["s", t("brand.textSmaller")], ["m", t("brand.textNormal")], ["l", t("brand.textLarger")]]} />
            </div>
          </div>
          {tinfo && (
            <div className={s.checks} role="group" aria-label={t("brand.readabilityOnArt")}>
              <div className={s.check}><span>{t("brand.checkTextOnArt")}</span><RatioPill v={tinfo.ratio} min={4.5} /></div>
              {tinfo.panel && <div className={s.note}>{t("brand.panelNote")}</div>}
              {tinfo.band && <div className={s.note}>{t("brand.bandNote")}</div>}
              <div className={s.note}>{t("brand.qrBackNote")}</div>
            </div>
          )}
        </div>
      )}

      {panel === "custom" && (
        <div className="sub">
          <h3>{t("brand.customTitle")}</h3>
          <span className={s.note}>{t("brand.customNote")}</span>
          <ol className={s.steps}>
            <li><i>{number(1)}</i><div><b>{t("brand.customStep1")}</b><small>{t("brand.customStep1Text")}</small></div></li>
            <li><i>{number(2)}</i><div><b>{t("brand.customStep2")}</b><small>{t("brand.customStep2Text")}</small></div></li>
            <li><i>{number(3)}</i><div><b>{t("brand.customStep3")}</b><small>{t("brand.customStep3Text")}</small></div></li>
            <li><i>{number(4)}</i><div><b>{t("brand.customStep4")}</b><small>{t("brand.customStep4Text")}</small></div></li>
          </ol>
          <BrandCustomPanel wsId={wsId} />
        </div>
      )}
    </div>
  );
}
