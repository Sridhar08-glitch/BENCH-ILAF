"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { ToolCardPage, companyLogo, toolColours } from "@/components/app/ToolCard";
import { SkeletonBlocks, useToast } from "@/components/app/ui";
import { Switch } from "@/components/app/Switch";
import { useI18n } from "@/lib/i18n/client";
import {
  HEIGHT, LAYOUTS, PERSON_ZONE, WIDTH, drawBackground, type BackgroundLayout, type BackgroundSpec, type BackgroundTheme, type Ctx,
} from "@/lib/tools/background";
import { readStoredStyle } from "@/lib/qr/client";
import { DEFAULT_COLOURS, type PaletteChoice } from "@/lib/tools/signature";
import type { Card, WorkspaceDetail } from "@/lib/types";

export default function BackgroundPage() {
  const { t } = useI18n();
  return (
    <Suspense fallback={<div className="view"><SkeletonBlocks rows={3} /></div>}>
      <ToolCardPage title={t("tools.bgTitle")} sub={t("tools.bgSub")}>
        {(card, ws, picker) => (
          <>
            {picker}
            <BackgroundMaker key={card.id} card={card} ws={ws} />
          </>
        )}
      </ToolCardPage>
    </Suspense>
  );
}

type Loaded = { image: HTMLImageElement; width: number; height: number } | null;

/** Load a picture so it can be drawn and still downloaded: it needs the server to allow cross-site pictures. */
function loadLogo(url: string): Promise<Loaded> {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve({ image, width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

function BackgroundMaker({ card, ws }: { card: Card; ws: WorkspaceDetail | undefined }) {
  const toast = useToast();
  const { t } = useI18n();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [layout, setLayout] = useState<BackgroundLayout>("qr-left");
  const [theme, setTheme] = useState<BackgroundTheme>("brand");
  const [soft, setSoft] = useState(false);
  const [guide, setGuide] = useState(true);
  const [paletteChoice, setPaletteChoice] = useState<PaletteChoice>(ws?.kind === "company" && ws.brand.palette ? "company" : "card");
  const [logo, setLogo] = useState<Loaded>(null);
  const [logoState, setLogoState] = useState<"none" | "loading" | "ok" | "blocked">("none");
  const [withLogo, setWithLogo] = useState(true);
  const logoUrl = companyLogo(ws);

  useEffect(() => {
    if (!logoUrl) {
      setLogoState("none");
      setLogo(null);
      return;
    }
    let live = true;
    setLogoState("loading");
    void loadLogo(logoUrl).then((l) => {
      if (!live) return;
      setLogo(l);
      setLogoState(l ? "ok" : "blocked");
    });
    return () => {
      live = false;
    };
  }, [logoUrl]);

  const cols = toolColours(card, ws);
  const palette = paletteChoice === "company" && cols.company ? cols.company : paletteChoice === "card" ? cols.card : DEFAULT_COLOURS;
  const spec: BackgroundSpec = {
    layout, theme, soft, palette, name: card.name, title: card.title, company: card.company, qrText: `${card.public_url}${card.public_url.includes("?") ? "&" : "?"}s=qr`, qrStyle: readStoredStyle(card.id),
  };

  // Live preview: the same drawing that is downloaded, repainted on every change.
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    drawBackground(ctx as unknown as Ctx, spec, withLogo ? logo : null);
    // spec is rebuilt every render from the values below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, theme, soft, paletteChoice, logo, withLogo, card, ws]);

  function download() {
    const el = canvas.current;
    if (!el) return;
    el.toBlob((blob) => {
      if (!blob) return toast(t("tools.bgMakeFailed"));
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${card.slug ?? card.public_code}-call-background.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, "image/png");
  }

  const pct = (v: number, total: number) => `${(v / total) * 100}%`;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,420px),1fr))", gap: 20, alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0, order: 2 }}>
        <div className="panel card">
          <div className="head">
            <h2><span className="chip"><Icon name="camera" size="s" /></span>{t("tools.bgPreview")}</h2>
            <button type="button" className="btn" onClick={download}><Icon name="download" size="s" />{t("tools.bgDownload")}</button>
          </div>
          <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", borderRadius: 10, overflow: "hidden", border: "1px solid var(--line)" }}>
            <canvas ref={canvas} width={WIDTH} height={HEIGHT} style={{ width: "100%", height: "100%", display: "block" }} role="img" aria-label={t("tools.bgCanvasAria", { name: card.name, layout: t(LAYOUTS.find((l) => l.key === layout)?.name ?? "tools.bgLayoutQrLeft") })} />
            {/* The guide sits over the picture in pixels (the picture is not mirrored), so it uses physical sides. */}
            {guide && (
              <div
                aria-hidden="true"
                style={{
                  position: "absolute", left: pct(PERSON_ZONE.x, WIDTH), top: pct(PERSON_ZONE.y, HEIGHT), width: pct(PERSON_ZONE.w, WIDTH), height: pct(PERSON_ZONE.h, HEIGHT),
                  border: "2px dashed rgba(255,255,255,.9)", outline: "1px dashed rgba(0,0,0,.6)", borderRadius: 12, display: "grid", placeItems: "start center", paddingTop: 8,
                  color: "#fff", textShadow: "0 1px 3px rgba(0,0,0,.8)", fontSize: 12, fontWeight: 700, pointerEvents: "none",
                }}
              >
                {t("tools.bgYouSit")}
              </div>
            )}
          </div>
          <div className="hint">{t("tools.bgHint")}</div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        <div className="panel card">
          <div className="head"><h2><span className="chip"><Icon name="card" size="s" /></span>{t("tools.bgLayout")}</h2></div>
          <div role="radiogroup" aria-label={t("tools.bgLayout")} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10 }}>
            {LAYOUTS.map((l) => (
              <label key={l.key} style={{ border: `2px solid ${layout === l.key ? "var(--orange)" : "var(--line)"}`, borderRadius: 14, padding: 10, cursor: "pointer", gap: 2, background: "#fff" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input className="chk" type="radio" name="layout" checked={layout === l.key} onChange={() => setLayout(l.key)} />
                  <b>{t(l.name)}</b>
                </span>
                <span className="hint">{t(l.hint)}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="panel card">
          <div className="head"><h2><span className="chip"><Icon name="palette" size="s" /></span>{t("tools.bgColours")}</h2></div>
          <label style={{ maxWidth: 320 }}>
            {t("tools.bgPalette")}
            <select value={paletteChoice} onChange={(e) => setPaletteChoice(e.target.value as PaletteChoice)}>
              <option value="card">{t("tools.palCard")}</option>
              {cols.company && <option value="company">{t("tools.palCompany")}</option>}
              <option value="default">{t("tools.palDefault")}</option>
            </select>
          </label>
          <div className="seg" role="group" aria-label={t("tools.bgStyleAria")} style={{ alignSelf: "flex-start" }}>
            {([["brand", t("tools.bgThemeBrand")], ["dark", t("tools.bgThemeDark")], ["light", t("tools.bgThemeLight")]] as const).map(([k, label]) => (
              <button key={k} type="button" aria-pressed={theme === k} onClick={() => setTheme(k)}>{label}</button>
            ))}
          </div>
          <div className="toggle">
            <div>{t("tools.bgSoft")}<small>{t("tools.bgSoftHint")}</small></div>
            <Switch checked={soft} onChange={setSoft} label={t("tools.bgSoft")} />
          </div>
          <div className="toggle">
            <div>{t("tools.bgShowLogo")}<small>{logoUrl ? (logoState === "blocked" ? t("tools.bgLogoBlocked") : t("tools.bgLogoRoom")) : t("tools.bgLogoNone")}</small></div>
            <Switch checked={withLogo && !!logoUrl} disabled={!logoUrl} onChange={setWithLogo} label={t("tools.bgShowLogo")} />
          </div>
          <div className="toggle">
            <div>{t("tools.bgGuide")}<small>{t("tools.bgGuideHint")}</small></div>
            <Switch checked={guide} onChange={setGuide} label={t("tools.bgGuide")} />
          </div>
        </div>
      </div>
    </div>
  );
}
