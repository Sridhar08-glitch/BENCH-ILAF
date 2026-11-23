"use client";

// "Change logo": pick a brand logo (any of ~3,000), a generic icon, or upload an image.
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { BrandGlyph } from "@/components/ButtonIcon";
import { LUCIDE_KEYS, LucideByKey } from "@/components/lucide-set";
import { api } from "@/lib/api";
import { useBrandGlyphs, useBrandIndex, useDebounced } from "@/lib/icons-client";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import { IMAGE_ACCEPT, isAllowedImage } from "@/lib/images";
import { tk, type MessageKey } from "@/lib/i18n";
import type { ItemIcon } from "@/lib/types";

const MAX_ICON = 1024 * 1024;

/** The message that names each generic icon (the keys are the icon ids of lucide-set). */
const ICON_NAMES: Record<string, MessageKey> = {
  mail: tk("editor.icoMail"), phone: tk("editor.icoPhone"), globe: tk("editor.icoGlobe"), "map-pin": tk("editor.icoMapPin"),
  calendar: tk("editor.icoCalendar"), file: tk("editor.icoFile"), download: tk("editor.icoDownload"), "shopping-bag": tk("editor.icoShoppingBag"),
  briefcase: tk("editor.icoBriefcase"), video: tk("editor.icoVideo"), music: tk("editor.icoMusic"), heart: tk("editor.icoHeart"),
  star: tk("editor.icoStar"), link: tk("editor.icoLink"), "message-circle": tk("editor.icoMessage"), camera: tk("editor.icoCamera"),
  image: tk("editor.icoImage"), book: tk("editor.icoBook"), coffee: tk("editor.icoCoffee"), gift: tk("editor.icoGift"),
  house: tk("editor.icoHouse"), "building-2": tk("editor.icoBuilding"), car: tk("editor.icoCar"), plane: tk("editor.icoPlane"),
  truck: tk("editor.icoTruck"), wrench: tk("editor.icoWrench"), hammer: tk("editor.icoHammer"), scissors: tk("editor.icoScissors"),
  utensils: tk("editor.icoUtensils"), wallet: tk("editor.icoWallet"), "credit-card": tk("editor.icoCreditCard"), laptop: tk("editor.icoLaptop"),
  smartphone: tk("editor.icoSmartphone"), headphones: tk("editor.icoHeadphones"), mic: tk("editor.icoMic"), newspaper: tk("editor.icoNewspaper"),
  "graduation-cap": tk("editor.icoGraduationCap"), award: tk("editor.icoAward"), users: tk("editor.icoUsers"), user: tk("editor.icoUser"),
  clock: tk("editor.icoClock"), tag: tk("editor.icoTag"), "qr-code": tk("editor.icoQrCode"), "share-2": tk("editor.icoShare"),
  send: tk("editor.icoSend"), rss: tk("editor.icoRss"), podcast: tk("editor.icoPodcast"), "gamepad-2": tk("editor.icoGamepad"),
  palette: tk("editor.icoPalette"), code: tk("editor.icoCode"), stethoscope: tk("editor.icoStethoscope"), dumbbell: tk("editor.icoDumbbell"),
  landmark: tk("editor.icoLandmark"),
};
/** Shown before the owner types anything. */
const POPULAR = [
  "gmail", "protonmail", "icloud", "whatsapp", "telegram", "signal", "instagram", "facebook", "linkedin", "x", "youtube", "tiktok",
  "snapchat", "pinterest", "github", "behance", "dribbble", "figma", "notion", "slack", "zoom", "googlemeet", "calendly", "shopify",
  "stripe", "paypal", "wise", "spotify", "applemusic", "soundcloud", "twitch", "discord", "reddit", "medium", "linktree", "googlemaps",
  "amazon", "etsy", "ebay", "uber", "airbnb", "booking", "tripadvisor", "trustpilot", "googleplay", "appstore", "patreon", "kofi",
];

type Tab = "brand" | "icons" | "upload";

interface Props {
  cardId: string;
  current: ItemIcon | null | undefined;
  onPick: (icon: ItemIcon | null) => void;
  onClose: () => void;
}

export function IconPicker({ cardId, current, onPick, onClose }: Props) {
  const { t, number } = useI18n();
  const [tab, setTab] = useState<Tab>("brand");
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim().toLowerCase(), 200);
  const index = useBrandIndex(tab === "brand");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("input")?.focus();
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onClose]);

  const rows = useMemo(() => {
    const idx = index.data;
    if (!idx) return [];
    if (!dq) {
      const by = new Map(idx.map((r) => [r[0], r]));
      return POPULAR.map((s) => by.get(s)).filter((r): r is NonNullable<typeof r> => !!r);
    }
    const starts: typeof idx = [];
    const contains: typeof idx = [];
    for (const r of idx) {
      const t = r[1].toLowerCase();
      if (t.startsWith(dq) || r[0].startsWith(dq)) starts.push(r);
      else if (t.includes(dq) || r[0].includes(dq)) contains.push(r);
      if (starts.length >= 60) break;
    }
    return [...starts, ...contains].slice(0, 60);
  }, [index.data, dq]);

  const glyphs = useBrandGlyphs(rows.map((r) => r[0]));

  return (
    <div className="sheet fixed" style={{ justifyContent: "center", alignItems: "center", padding: 12 }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dlg" role="dialog" aria-modal="true" aria-label={t("editor.pickerTitle")} ref={ref}>
        <div className="head">
          <h2>{t("editor.pickerTitle")}</h2>
          <button type="button" className="x" aria-label={t("common.close")} onClick={onClose}><Icon name="x2" size="s" /></button>
        </div>
        <div className="tabs" role="tablist">
          {(["brand", "icons", "upload"] as Tab[]).map((k) => (
            <button key={k} type="button" role="tab" className="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
              {k === "brand" ? t("editor.pickerBrands") : k === "icons" ? t("editor.pickerIcons") : t("common.upload")}
            </button>
          ))}
        </div>

        {tab === "brand" && (
          <>
            <label className="search">
              <Icon name="search" size="s" />
              <input dir="auto" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("editor.pickerSearch", { n: number(3000) })} aria-label={t("editor.pickerSearchAria")} />
            </label>
            {index.isLoading && <p className="hint">{t("editor.pickerLoading")}</p>}
            {index.error && <p className="err">{t("editor.pickerError")}</p>}
            {index.data && rows.length === 0 && <p className="hint">{t("editor.pickerNone")}</p>}
            <div className="iconsgrid">
              {rows.map(([slug, title]) => {
                const g = glyphs.data?.[slug];
                return (
                  <button key={slug} type="button" className="ipick" title={title} aria-pressed={current?.type === "brand" && current.key === slug} onClick={() => onPick({ type: "brand", key: slug, image_url: null })}>
                    {g ? <BrandGlyph path={g.path} size="l" /> : <span className="skeleton" style={{ width: 24, height: 24 }} />}
                    <span>{title}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {tab === "icons" && (
          <div className="iconsgrid">
            {LUCIDE_KEYS.map((k) => {
              const name = ICON_NAMES[k] ? t(ICON_NAMES[k]) : k.replace(/-/g, " ");
              return (
                <button key={k} type="button" className="ipick" title={name} aria-pressed={current?.type === "lucide" && current.key === k} onClick={() => onPick({ type: "lucide", key: k, image_url: null })}>
                  <LucideByKey name={k} size={24} />
                  <span>{name}</span>
                </button>
              );
            })}
          </div>
        )}

        {tab === "upload" && <UploadTab cardId={cardId} onUse={(url) => onPick({ type: "upload", key: null, image_url: url })} />}

        <div className="row" style={{ justifyContent: "space-between" }}>
          <button type="button" className="btn ghost sm" onClick={() => onPick(null)}>{t("editor.pickerAuto")}</button>
          <button type="button" className="btn ghost sm" onClick={onClose}>{t("common.cancel")}</button>
        </div>
      </div>
    </div>
  );
}

function UploadTab({ cardId, onUse }: { cardId: string; onUse: (url: string) => void }) {
  const { t, number } = useI18n();
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [err, setErr] = useState("");

  async function pick(file: File | undefined) {
    if (!file) return;
    setErr("");
    if (!isAllowedImage(file)) return setErr(t("common.useImage"));
    if (file.size > MAX_ICON) return setErr(t("editor.pictureTooLarge", { mb: number(MAX_ICON / (1024 * 1024)) }));
    setBusy(true);
    try {
      const r = await api.uploadIcon(cardId, file);
      setUrl(r.image_url);
    } catch (e) {
      setErr(apiErrorText(e, t, "editor.pickerUploadFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pane">
      <label>
        {t("editor.pickerOwn", { mb: number(MAX_ICON / (1024 * 1024)) })}
        <input type="file" accept={IMAGE_ACCEPT} onChange={(e) => void pick(e.target.files?.[0])} />
      </label>
      {busy && <p className="hint">{t("editor.uploading")}</p>}
      {err && <p className="err" role="alert">{err}</p>}
      {url && (
        <div className="row">
          <img src={url} alt={t("editor.pickerUploaded")} width={64} height={64} style={{ borderRadius: 8, border: "1px solid var(--line)", objectFit: "contain", background: "#fff" }} />
          <button type="button" className="btn sm" onClick={() => onUse(url)}>{t("editor.pickerUse")}</button>
        </div>
      )}
      <p className="hint">{t("editor.pickerSquare")}</p>
    </div>
  );
}
