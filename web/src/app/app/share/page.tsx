"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { CardView } from "@/components/card/CardView";
import { Empty, ErrorBox, PageHead, QrPreview, SkeletonBlocks, useToast } from "@/components/app/ui";
import { useWs } from "@/components/app/WorkspaceContext";
import { Weave, slot } from "@/components/ops/shared";
import { APP_NAME } from "@/lib/config";
import { shortAddress } from "@/lib/card-address";
import { QrStylePanel, useQrStudio } from "@/components/app/QrStudio";
import { saveOfflineQr } from "@/lib/pwa/store";
import { useCards, useWorkspaceDetail } from "@/lib/hooks";
import { defaultFirst } from "@/lib/card-order";
import { useResolvedIcons } from "@/lib/icons-client";
import { useI18n } from "@/lib/i18n/client";
import { QR_MAX_BYTES, buildQrContact, qrSizeWarning } from "@/lib/card/qr-vcard";
import type { Card } from "@/lib/types";

export default function QrPage() {
  return (
    <Suspense fallback={<SkeletonBlocks rows={3} />}>
      <QrInner />
    </Suspense>
  );
}

function QrInner() {
  const { current } = useWs();
  const { t } = useI18n();
  const cards = useCards(current.id);
  const router = useRouter();
  const param = useSearchParams().get("card");
  const list = cards.data ?? [];
  const card = list.find((c) => c.id === param) ?? defaultFirst(list)[0];

  if (cards.isLoading) return <div className="view"><SkeletonBlocks rows={3} /></div>;
  if (cards.error) return <div className="view"><ErrorBox error={cards.error} onRetry={() => void cards.refetch()} /></div>;
  if (!card) {
    return (
      <div className="view">
        <PageHead title={t("tools.qrTitle")} />
        <div className="panel"><Empty title={t("tools.qrNoCard")} action={<Link className="btn sm" href="/app/cards">{t("tools.qrCreate")}</Link>}>{t("tools.qrNoCardText")}</Empty></div>
      </div>
    );
  }
  return (
    <QrView
      key={card.id}
      card={card}
      cards={list}
      onPick={(id) => router.replace(`/app/share?card=${id}`)}
    />
  );
}

function QrView({ card, cards, onPick }: { card: Card; cards: Card[]; onPick: (id: string) => void }) {
  const toast = useToast();
  const { t } = useI18n();
  const [scan, setScan] = useState(true);
  const [type, setType] = useState<"link" | "contact">("link");
  const [withAddress, setWithAddress] = useState(false);
  const [withNote, setWithNote] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const icons = useResolvedIcons(card.items);

  // The contact is built in the browser, so it works with no internet at all once it is scanned.
  const contact = useMemo(
    () => buildQrContact({ name: card.name, title: card.title, company: card.company, address: card.address, note: card.vc.note, items: card.items }, { address: withAddress, note: withNote }),
    [card, withAddress, withNote],
  );
  const warning = qrSizeWarning(contact, t);
  const tooLong = contact.bytes > QR_MAX_BYTES;
  // The picture, its saved look, the scan check and the downloads (what a phone camera opens is the card link or the contact).
  const ws = useWorkspaceDetail(card.workspace_id).data;
  const studio = useQrStudio(card, ws, type === "contact" ? contact.text : `${card.public_url}?s=qr`);

  const nfcUrl = `${card.public_url}${card.public_url.includes("?") ? "&" : "?"}s=nfc`;
  const published = card.status === "published";

  useEffect(() => {
    if (!scan) return;
    timer.current = window.setTimeout(() => setScan(false), 1700);
    return () => window.clearTimeout(timer.current);
  }, [scan]);

  async function copy(text: string, ok: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast(ok);
    } catch {
      toast(t("tools.qrCopyFailed"));
    }
  }

  // Keep this card's codes on the device so "My QR" still opens with no connection (shown by the offline page).
  const { ready, style: savedStyle, logoHref } = studio;
  useEffect(() => {
    if (!published || !ready) return;
    const plain = buildQrContact({ name: card.name, title: card.title, company: card.company, address: card.address, note: card.vc.note, items: card.items }, { address: false, note: false });
    void saveOfflineQr({
      id: card.id, name: card.name, title: card.title, company: card.company, publicUrl: card.public_url, linkText: `${card.public_url}?s=qr`,
      contactText: plain.bytes <= QR_MAX_BYTES ? plain.text : "", style: savedStyle, logoHref, savedAt: Date.now(),
    });
  }, [published, ready, card, savedStyle, logoHref]);

  async function download(format: "png" | "svg") {
    const base = card.slug ?? card.public_code;
    try {
      await studio.download(format, type === "contact" ? `${base}-contact-qr` : `${base}-qr`);
    } catch {
      toast(t("tools.qrDownloadFailed"));
    }
  }

  return (
    <div className="view">
      <PageHead title={t("tools.qrTitle")} sub={t("tools.qrSub", { name: card.name })}>
        <button type="button" className="btn ghost" onClick={() => void copy(card.public_url, t("tools.qrLinkCopied"))}><Icon name="copy" size="s" />{t("tools.qrCopyLink")}</button>
        <button type="button" className="btn" disabled={!studio.dataUrl} onClick={() => void download("png")}><Icon name="download" size="s" />{t("tools.qrDownloadPng")}</button>
        <button type="button" className="btn ghost" disabled={!studio.dataUrl} onClick={() => void download("svg")}><Icon name="download" size="s" />{t("tools.qrDownloadSvg")}</button>
      </PageHead>

      <div role="group" aria-label={t("tools.qrHolds")} className="seg" style={{ alignSelf: "flex-start", flexWrap: "wrap" }}>
        {([["link", t("tools.qrTypeLink")], ["contact", t("tools.qrTypeContact")]] as const).map(([k, label]) => (
          <button key={k} type="button" aria-pressed={type === k} onClick={() => setType(k)}>{label}</button>
        ))}
      </div>
      {type === "contact" && (
        <div className="notice" role="status">
          <Icon name="scan" />
          <div className="grow">
            <b>{t("tools.qrOffline")}</b>
            {t("tools.qrOfflineText")}
            <div className="row" style={{ marginBlockStart: 8, gap: 16 }}>
              <label className="chkrow"><input className="chk" type="checkbox" checked={withAddress} onChange={(e) => setWithAddress(e.target.checked)} />{t("tools.qrAddAddress")}</label>
              <label className="chkrow"><input className="chk" type="checkbox" checked={withNote} onChange={(e) => setWithNote(e.target.checked)} />{t("tools.qrAddNote")}</label>
            </div>
          </div>
        </div>
      )}
      {type === "contact" && warning && <div className={`notice ${tooLong ? "bad" : "warn"}`} role={tooLong ? "alert" : "status"}><Icon name="alert" /><div className="grow">{warning}</div></div>}

      {cards.length > 1 && (
        <label style={{ maxWidth: 420 }}>
          {t("tools.qrCard")}
          <select value={card.id} onChange={(e) => onPick(e.target.value)}>
            {cards.map((c) => <option key={c.id} value={c.id}>{c.name || t("tools.qrUntitled")} - {shortAddress(c)}</option>)}
          </select>
        </label>
      )}

      {!published && (
        <div className="notice warn" role="status">
          <Icon name="alert" />
          <div className="grow">
            <b>{t("tools.qrNotPublished")}</b>
            {t("tools.qrNotPublishedText")}
            <div style={{ marginBlockStart: 8 }}><Link className="btn sm" href={`/app/cards/${card.id}`}>{t("tools.qrOpenEditor")}</Link></div>
          </div>
        </div>
      )}

      <div className="g3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,340px),1fr))" }}>
        <div className="panel card qrcard" data-guide="qr-main">
          <span className="pill dark" dir="auto">{card.name}</span>
          <div className="qrbig">
            {type === "contact" && tooLong ? (
              <span className="hint">{t("tools.qrShorten")}</span>
            ) : studio.dataUrl ? (
              <img src={studio.dataUrl} alt={type === "contact" ? t("tools.qrContactAlt", { name: card.name }) : t("tools.qrAlt", { name: card.name })} />
            ) : (
              <QrPreview text={`${card.public_url}?s=qr`} />
            )}
          </div>
          <div>
            {type === "contact" ? (
              <>
                <b style={{ fontSize: 16 }} dir="auto">{card.name}</b>
                <div className="hint">{t("tools.qrSavesContact", { bytes: contact.bytes })}</div>
              </>
            ) : (
              <>
                <b className="ltr" style={{ fontSize: 16, overflowWrap: "anywhere" }}>{shortAddress(card)}</b>
                <div className="hint">{t("tools.qrPointCamera")}</div>
              </>
            )}
          </div>
          <div className="row" style={{ justifyContent: "center" }}>
            <span className="pill"><Icon name="scan" size="s" />{t("tools.qrScans", { n: card.stats.scans })}</span>
            <span className="pill"><Icon name="nfc" size="s" />{t("tools.qrNfcReady")}</span>
          </div>
        </div>

        <div className="panel card" style={{ alignItems: "center" }}>
          <div className="head" style={{ width: "100%" }}>
            <h2><span className="chip"><Icon name="scan" size="s" /></span>{t("tools.qrWhatScanShows")}</h2>
            <button type="button" className="btn ghost sm" onClick={() => setScan(true)}>{t("tools.qrScanAgain")}</button>
          </div>
          <div className="device" style={{ ["--dw" as string]: "340px" }}>
            <div className={`scr ${scan ? "" : "done"}`}>
              <div className="scanwrap">
                <div className="scanpage" style={{ overflow: "hidden" }}>
                  <CardView
                    mode="thumb"
                    autoplay={false}
                    data={{
                      name: card.name, title: card.title, company: card.company, address: card.address, photoUrl: card.photo_url, saveContact: card.save_contact,
                      design: card.design, coverUrl: card.cover_url ?? null, publicUrl: card.public_url, items: card.items.map((it, i) => ({ ...it, res: icons[i] })),
                    }}
                  />
                </div>
                <div className="cam" aria-hidden={!scan}>
                  <div className="vf"><QrPreview text={`${card.public_url}?s=qr`} /></div>
                  <span>{t("tools.qrScanning")}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <QrStylePanel card={card} ws={ws} studio={studio} />

      <div className="g3">
        <div className="panel card">
          <div className="head"><h2><span className="chip"><Icon name="link" size="s" /></span>{t("tools.qrCardAddress")}</h2></div>
          <div className="copybox">
            <input readOnly value={card.public_url} aria-label={t("tools.qrCardLinkAria")} onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="btn ghost sm" onClick={() => void copy(card.public_url, t("tools.qrLinkCopied"))}>{t("common.copy")}</button>
          </div>
          <div className="hint">{t("tools.qrOldLinks")} <Link href={`/app/cards/${card.id}`} style={{ fontWeight: 700 }}>{t("tools.qrChangeAddress")}</Link></div>
        </div>
        <div className="panel card">
          <div className="head"><h2><span className="chip"><Icon name="nfc" size="s" /></span>{t("tools.qrNfcTag")}</h2></div>
          <div className="nfc">
            <span className="chip"><Icon name="nfc" size="l" /></span>
            <div style={{ flex: 1, minWidth: 0 }}><b>{t("tools.qrTapToOpen")}</b><div className="hint">{t("tools.qrNfcText", { app: APP_NAME })}</div></div>
          </div>
          <div className="copybox">
            <input readOnly value={nfcUrl} aria-label={t("tools.qrNfcLinkAria")} onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="btn ghost sm" onClick={() => void copy(nfcUrl, t("tools.qrNfcCopied"))}>{t("common.copy")}</button>
          </div>
        </div>
        <div className="panel card">
          <div className="head"><h2><span className="chip"><Icon name="share" size="s" /></span>{t("common.share")}</h2></div>
          <div className="row">
            <a className="btn ghost sm" href={`https://wa.me/?text=${encodeURIComponent(card.public_url)}`} target="_blank" rel="noopener noreferrer">{t("tools.qrWhatsApp")}</a>
            <a className="btn ghost sm" href={`mailto:?subject=${encodeURIComponent(card.name)}&body=${encodeURIComponent(card.public_url + "?s=email")}`}>{t("common.email")}</a>
            <a className="btn ghost sm" href={card.public_url} target="_blank" rel="noopener noreferrer">{t("tools.qrOpenCard")}</a>
          </div>
          <div className="hint"><Weave text={t("tools.qrEmailTag", { tag: slot(0) })} nodes={[<b key="tag" className="ltr">?s=email</b>]} /></div>
        </div>
      </div>
    </div>
  );
}
