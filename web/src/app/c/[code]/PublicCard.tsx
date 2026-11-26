"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./PublicCard.module.css";
import { CardBehaviour, type TabGroup } from "@/components/card/CardBehaviour";
import { SaveSheet } from "@/components/card/SaveSheet";
import { Icon } from "@/components/Icon";
import { useI18n } from "@/lib/i18n/client";
import { parseVcard, type ContactPreview } from "@/lib/card/vcard";
import { fetchVcardText, sendEvent } from "@/lib/public-api";
import type { EventSource, PublicFeatures } from "@/lib/types";
import { CommerceLayer } from "./CommerceLayer";
import { ExchangeDialog, MeetingDialog } from "./ExchangeDialogs";
import { VerifiedBadge } from "@/components/card/VerifiedBadge";

interface Props {
  code: string;
  source: EventSource | null;
  /** The few card fields the buttons around the card need (share, Save contact). */
  contact: { name: string; title: string; company: string; publicUrl: string; vcardUrl: string; photoUrl: string | null };
  pageVars: Record<string, string>;
  kinds: string[];
  tabs?: Partial<Record<TabGroup, string>>;
  /** The exchange-contact settings and whether the built-in meeting form is on this card. */
  features?: PublicFeatures;
  /** The company's proven e-mail domain: shows the "Verified company" badge under the card. */
  verifiedDomain?: string | null;
  play: boolean;
  /** The card markup, drawn on the server. */
  children: ReactNode;
  /** The rich sections under the card (video, products, hours...), drawn on the server. */
  sections?: ReactNode;
  /** The end of the page (QR code, "Powered by"), drawn after the extras and the share buttons when the card has extras. */
  after?: ReactNode;
}

export function PublicCard({ code, source, contact, pageVars, kinds, tabs, features, verifiedDomain, play, children, sections, after }: Props) {
  const { t } = useI18n();
  const [sheet, setSheet] = useState<ContactPreview | null>(null);
  const [leadOpen, setLeadOpen] = useState(false);
  const [meetOpen, setMeetOpen] = useState(false);
  const exchange = features?.exchange;
  const exchangeOn = !features || features.exchange.enabled;
  const [toast, setToast] = useState("");
  const viewed = useRef(false);

  // One view is reported per page load, before anything else, without waiting for the answer.
  useEffect(() => {
    if (viewed.current) return;
    viewed.current = true;
    sendEvent(code, "view", source);
  }, [code, source]);

  const say = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 2200);
  }, []);

  const openSave = useCallback(async () => {
    // Show the sheet at once with the name, then fill in the real fields from the contact file.
    setSheet({ name: contact.name, subtitle: [contact.title, contact.company].filter(Boolean).join(" - "), hasPhoto: true, rows: [], note: "" });
    const text = await fetchVcardText(contact.vcardUrl);
    if (text) setSheet(parseVcard(text));
  }, [contact]);

  const share = useCallback(async () => {
    const url = contact.publicUrl;
    const data = { title: contact.name, text: `${contact.name}${contact.title ? `, ${contact.title}` : ""}`, url };
    try {
      if (navigator.share) {
        await navigator.share(data);
        return;
      }
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
    }
    try {
      await navigator.clipboard.writeText(url);
      say(t("card.linkCopied"));
    } catch {
      say(t("card.copyThisLink", { url }));
    }
  }, [contact, say, t]);

  const toolsEl = (
    <div className={styles.tools}>
      <button type="button" className={styles.tool} onClick={share}>
        <Icon name="share" size="s" /> {t("card.share")}
      </button>
      {exchangeOn && (
        <button type="button" className={styles.tool} onClick={() => setLeadOpen(true)}>
          <Icon name="adduser" size="s" /> {t("card.shareDetails")}
        </button>
      )}
    </div>
  );

  return (
    <div className={styles.wrap} style={{ ...pageVars, "--tools-h": "64px" } as React.CSSProperties}>
      <div className={styles.col}>
        <CardBehaviour kinds={kinds} tabs={tabs} play={play} onSave={openSave} onMeeting={() => setMeetOpen(true)} onItemClick={(kind) => sendEvent(code, "link_click", source, kind)}>
          {children}
        </CardBehaviour>
        {after ? <>{sections}{toolsEl}{after}</> : <>{toolsEl}{sections}</>}
        {verifiedDomain && <VerifiedBadge domain={verifiedDomain} label={t("cardx.verified")} tip={t("cardx.verifiedTip", { domain: verifiedDomain })} />}
        <div className={styles.legal}>
          <a href="/privacy" target="_blank" rel="noopener noreferrer">{t("common.privacy")}</a>
        </div>
      </div>

      {sheet && (
        <SaveSheet
          position="fixed"
          contact={sheet}
          photoUrl={contact.photoUrl}
          downloadHref={contact.vcardUrl}
          onAdd={() => sendEvent(code, "save", source)}
          onClose={() => setSheet(null)}
        />
      )}
      {leadOpen && exchange && (
        <ExchangeDialog code={code} source={source} name={contact.name} features={exchange} vcardUrl={contact.vcardUrl} onClose={() => setLeadOpen(false)} />
      )}
      <CommerceLayer code={code} source={source} name={contact.name} />
      {meetOpen && exchange && <MeetingDialog code={code} source={source} name={contact.name} features={exchange} onClose={() => setMeetOpen(false)} />}
      {toast && (
        <div className={styles.toast} role="status">
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}
