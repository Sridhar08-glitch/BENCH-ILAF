"use client";

// A card page drawn exactly like the public one (same frame, footer, area below the card and
// opening), but in the browser from data the editor hands over, and with nothing sent anywhere. Used by the
// "Open preview in a new tab" pages.
import { useCallback, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import styles from "@/app/c/[code]/PublicCard.module.css";
import { Icon } from "@/components/Icon";
import { SaveSheet } from "@/components/card/SaveSheet";
import { CardView, type CardViewData } from "@/components/card/CardView";
import { CardTail } from "@/components/card/CardTail";
import { useBrandInfo } from "@/lib/brand-info-client";
import { previewFromCard } from "@/lib/card/vcard";
import { buildInput, drawPage } from "@/lib/library/render";
import { cardI18n } from "@/lib/card/labels";
import { dirOf } from "@/lib/i18n/config";
import { ExchangeDialog } from "@/app/c/[code]/ExchangeDialogs";
import { useI18n } from "@/lib/i18n/client";
import type { PublicFeatures } from "@/lib/types";

/** Every Save contact field on, like a card that shares everything. */
const FULL_VC = { company: true, photo: true, phones: true, emails: true, urls: true, social: true, addr: true, note: "" };

/** The exchange form as a new card has it before the owner changes anything. */
const PREVIEW_EXCHANGE: PublicFeatures["exchange"] = {
  enabled: true,
  fields: { email: "optional", phone: "optional", company: "optional", note: "optional" },
  consent_text: "",
  privacy_url: null,
};

export function LivePage({ data, extra }: { data: CardViewData; /** The extras under the card (video, products, hours ...), when the page has them. */ extra?: ReactNode }) {
  // The preview page speaks the card's language, like the public page does.
  const ct = cardI18n(data.locale ?? "en").t;
  const { t } = useI18n();
  const [sheet, setSheet] = useState(false);
  const [leadOpen, setLeadOpen] = useState(false);
  const [toast, setToast] = useState("");
  const say = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 2400);
  }, []);
  const brand = useBrandInfo(data.brand);
  const full = useMemo(() => (brand === data.brand ? data : { ...data, brand }), [data, brand]);
  // Only the colours of the page are needed here: the card itself is drawn by CardView.
  const vars = useMemo(() => drawPage(buildInput(full, "live", false), full, "live").pageVars, [full]);
  const contact = useMemo(
    () => previewFromCard({
      name: data.name, title: data.title, company: data.company, address: data.address, vc: FULL_VC, cardUrl: data.publicUrl,
      items: data.items.map((i) => ({ kind: i.kind, value: i.value, label: i.label ?? "", on: i.on !== false })) as never,
    }),
    [data],
  );
  return (
    <div className={styles.wrap} lang={data.locale ?? "en"} dir={dirOf(data.locale ?? "en")} style={{ ...vars, "--tools-h": "64px" } as CSSProperties}>
      <div className={styles.col}>
        <CardView data={data} mode="live" fullHeight onSave={() => setSheet(true)} noTail />
        {extra}
        <div className={styles.tools}>
          <button type="button" className={styles.tool} onClick={() => say(t("card.previewShare"))}><Icon name="share" size="s" /> {ct("card.share")}</button>
          <button type="button" className={styles.tool} onClick={() => setLeadOpen(true)}><Icon name="adduser" size="s" /> {ct("card.shareDetails")}</button>
        </div>
        <CardTail data={full} />
      </div>
      {sheet && <SaveSheet position="fixed" contact={contact} photoUrl={data.photoUrl} onAdd={() => undefined} onClose={() => setSheet(false)} />}
      {leadOpen && (
        <ExchangeDialog
          code="preview"
          source={null}
          name={data.name}
          features={{ ...PREVIEW_EXCHANGE, consent_text: t("card.previewConsent") }}
          vcardUrl=""
          preview
          onClose={() => setLeadOpen(false)}
        />
      )}
      {toast && (
        <div className={styles.toast} role="status">
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}
