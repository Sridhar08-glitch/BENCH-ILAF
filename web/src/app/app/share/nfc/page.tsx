"use client";

// Writes the card's address to an NFC tag from the phone (Web NFC: Chrome on Android), and explains NFC cards in plain words.
import { Suspense, useEffect, useReducer, useRef } from "react";
import { Icon } from "@/components/Icon";
import { ToolCardPage } from "@/components/app/ToolCard";
import { SkeletonBlocks, useToast } from "@/components/app/ui";
import { APP_NAME } from "@/lib/config";
import { useI18n } from "@/lib/i18n/client";
import { tk, type MessageKey } from "@/lib/i18n";
import { TAG_TYPES, ndefUrlBytes, nfcErrorCode, nfcReduce, nfcUrl, sameUrl, smallestTag, type NfcErrorCode, type NfcState, type NfcSupport } from "@/lib/nfc/nfc";
import type { Card } from "@/lib/types";

// The parts of Web NFC this page uses (not in the standard TypeScript types).
interface NdefRecordLike { recordType: string; data?: DataView | ArrayBuffer | string }
interface NdefReadingEvent extends Event { message: { records: NdefRecordLike[] } }
interface NdefReaderLike {
  write(message: { records: { recordType: string; data: string }[] }, options?: { overwrite?: boolean; signal?: AbortSignal }): Promise<void>;
  scan(options?: { signal?: AbortSignal }): Promise<void>;
  onreading: ((e: NdefReadingEvent) => void) | null;
  onreadingerror: (() => void) | null;
}
type NdefReaderCtor = new () => NdefReaderLike;

function readerCtor(): NdefReaderCtor | null {
  return typeof window !== "undefined" && "NDEFReader" in window ? ((window as unknown as { NDEFReader: NdefReaderCtor }).NDEFReader) : null;
}

/** The first URL on a tag as text (a URL record or a text record that holds an address). */
function firstUrl(records: NdefRecordLike[]): string {
  for (const r of records) {
    if (r.recordType !== "url" && r.recordType !== "text") continue;
    const d = r.data;
    if (typeof d === "string") return d;
    if (d instanceof DataView) return new TextDecoder().decode(d);
    if (d instanceof ArrayBuffer) return new TextDecoder().decode(d);
  }
  return "";
}

const ERRORS: Record<NfcErrorCode, MessageKey> = {
  denied: tk("growth.nfcErrDenied"), unreadable: tk("growth.nfcErrUnreadable"), aborted: tk("growth.nfcErrAborted"), too_big: tk("growth.nfcErrTooBig"),
  insecure: tk("growth.nfcErrInsecure"), unsupported: tk("growth.nfcErrUnsupported"), failed: tk("growth.nfcErrFailed"),
};

export default function NfcPage() {
  const { t } = useI18n();
  return (
    <Suspense fallback={<div className="view"><SkeletonBlocks rows={3} /></div>}>
      <ToolCardPage title={t("growth.nfcTitle")} sub={t("growth.nfcSub")}>
        {(card, _ws, picker) => (
          <>
            {picker}
            <NfcWriter key={card.id} card={card} />
          </>
        )}
      </ToolCardPage>
    </Suspense>
  );
}

function NfcWriter({ card }: { card: Card }) {
  const { t, number } = useI18n();
  const toast = useToast();
  const [state, dispatch] = useReducer(nfcReduce, { kind: "checking" } as NfcState);
  const abort = useRef<AbortController | null>(null);
  const url = nfcUrl(card.public_url);
  const bytes = ndefUrlBytes(url);
  const smallest = smallestTag(url);
  const published = card.status === "published";

  useEffect(() => {
    const support: NfcSupport = { hasReader: readerCtor() !== null, secure: window.isSecureContext, mobile: /Android|iPhone|iPad/i.test(navigator.userAgent) };
    dispatch({ type: "support", support });
    return () => abort.current?.abort();
  }, []);

  async function write() {
    const Reader = readerCtor();
    if (!Reader) return;
    dispatch({ type: "write" });
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      await new Reader().write({ records: [{ recordType: "url", data: url }] }, { overwrite: true, signal: ctl.signal });
      dispatch({ type: "written" });
    } catch (e) {
      dispatch({ type: "fail", code: nfcErrorCode(e) });
    }
  }

  async function verify() {
    const Reader = readerCtor();
    if (!Reader) return;
    dispatch({ type: "verify" });
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    const timer = window.setTimeout(() => ctl.abort(), 30000);
    try {
      const reader = new Reader();
      reader.onreading = (e) => {
        window.clearTimeout(timer);
        const found = firstUrl(e.message.records);
        ctl.abort();
        dispatch({ type: "verified", matches: sameUrl(found, url), found });
      };
      reader.onreadingerror = () => {
        window.clearTimeout(timer);
        ctl.abort();
        dispatch({ type: "fail", code: "unreadable" });
      };
      await reader.scan({ signal: ctl.signal });
    } catch (e) {
      window.clearTimeout(timer);
      dispatch({ type: "fail", code: nfcErrorCode(e) });
    }
  }

  function cancel() {
    abort.current?.abort();
    dispatch({ type: "fail", code: "aborted" });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      toast(t("growth.nfcCopied"));
    } catch {
      toast(t("tools.qrCopyFailed"));
    }
  }

  return (
    <>
      <div className="panel card">
        <div className="head"><h2><span className="chip"><Icon name="nfc" size="s" /></span>{t("growth.nfcWhatHead")}</h2></div>
        <p style={{ margin: 0 }}>{t("growth.nfcWhat", { app: APP_NAME })}</p>
        <p className="hint" style={{ margin: 0 }}>{t("growth.nfcWhatTap")}</p>
      </div>

      {!published && (
        <div className="notice warn" role="status">
          <Icon name="alert" />
          <div className="grow"><b>{t("tools.qrNotPublished")}</b>{t("growth.nfcNotPublished")}</div>
        </div>
      )}

      <div className="g3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,340px),1fr))" }}>
        <div className="panel card">
          <div className="head"><h2><span className="chip"><Icon name="link" size="s" /></span>{t("growth.nfcLinkHead")}</h2></div>
          <div className="copybox">
            <input readOnly value={url} aria-label={t("tools.qrNfcLinkAria")} onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="btn ghost sm" onClick={() => void copy()}>{t("common.copy")}</button>
          </div>
          <div className="hint">{t("growth.nfcLinkHint")}</div>
          <div className="hint" role="status">
            {smallest ? t("growth.nfcSize", { bytes: number(bytes), tag: smallest.name }) : t("growth.nfcSizeTooBig", { bytes: number(bytes) })}
          </div>
        </div>

        <div className="panel card" data-guide="nfc-write">
          <div className="head"><h2><span className="chip"><Icon name="tap" size="s" /></span>{t("growth.nfcWriteHead")}</h2></div>
          <WriteBody state={state} onWrite={() => void write()} onVerify={() => void verify()} onCancel={cancel} onReset={() => dispatch({ type: "reset" })} url={url} />
          <div className="hint">{t("growth.nfcLockNote")}</div>
        </div>
      </div>

      <div className="g3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,340px),1fr))" }}>
        <div className="panel card">
          <div className="head"><h2><span className="chip"><Icon name="card" size="s" /></span>{t("growth.nfcTagsHead")}</h2></div>
          <p className="hint" style={{ margin: 0 }}>{t("growth.nfcTagsText")}</p>
          <ul style={{ margin: 0, paddingInlineStart: 18, display: "grid", gap: 6 }}>
            {TAG_TYPES.map((tag) => (
              <li key={tag.id}>
                <b className="ltr">{tag.name}</b> {t("growth.nfcTagBytes", { bytes: number(tag.bytes) })} {tag.id === "ntag213" && <span className="pill">{t("growth.nfcTagBest")}</span>}
              </li>
            ))}
          </ul>
          <div className="hint">{t("growth.nfcTagsNote")}</div>
        </div>

        <div className="panel card">
          <div className="head"><h2><span className="chip"><Icon name="phone" size="s" /></span>{t("growth.nfcIosHead")}</h2></div>
          <p style={{ margin: 0 }}>{t("growth.nfcIosText")}</p>
          <ol style={{ margin: 0, paddingInlineStart: 20, display: "grid", gap: 6 }}>
            <li>{t("growth.nfcIosStep1")}</li>
            <li>{t("growth.nfcIosStep2")}</li>
            <li>{t("growth.nfcIosStep3")}</li>
            <li>{t("growth.nfcIosStep4")}</li>
          </ol>
          <div className="hint">{t("growth.nfcIosShortcuts")}</div>
        </div>

        <div className="panel card">
          <div className="head"><h2><span className="chip"><Icon name="check" size="s" /></span>{t("growth.nfcTestHead")}</h2></div>
          <ol style={{ margin: 0, paddingInlineStart: 20, display: "grid", gap: 6 }}>
            <li>{t("growth.nfcTestStep1")}</li>
            <li>{t("growth.nfcTestStep2")}</li>
            <li>{t("growth.nfcTestStep3")}</li>
          </ol>
          <div className="hint">{t("growth.nfcTestNote")}</div>
        </div>
      </div>
    </>
  );
}

function WriteBody({ state, url, onWrite, onVerify, onCancel, onReset }: { state: NfcState; url: string; onWrite: () => void; onVerify: () => void; onCancel: () => void; onReset: () => void }) {
  const { t } = useI18n();
  switch (state.kind) {
    case "checking":
      return <span className="skeleton" style={{ height: 40 }} />;
    case "unsupported":
      return (
        <div className="notice" role="status">
          <Icon name="alert" />
          <div className="grow">
            <b>{t("growth.nfcUnsupported")}</b>
            {state.reason === "insecure" ? t("growth.nfcUnsupportedInsecure") : t("growth.nfcUnsupportedText")}
          </div>
        </div>
      );
    case "idle":
      return (
        <>
          <p style={{ margin: 0 }}>{t("growth.nfcWriteText")}</p>
          <button type="button" className="btn" onClick={onWrite}><Icon name="nfc" size="s" />{t("growth.nfcWriteButton")}</button>
        </>
      );
    case "writing":
      return (
        <>
          <div className="notice" role="status" aria-live="polite"><Icon name="tap" /><div className="grow"><b>{t("growth.nfcHold")}</b>{t("growth.nfcHoldText")}</div></div>
          <button type="button" className="btn ghost" onClick={onCancel}>{t("common.cancel")}</button>
        </>
      );
    case "written":
      return (
        <>
          <div className="notice" role="status" aria-live="polite"><Icon name="check" /><div className="grow"><b>{t("growth.nfcDone")}</b>{t("growth.nfcDoneText")}</div></div>
          <div className="row">
            <button type="button" className="btn" onClick={onVerify}>{t("growth.nfcVerify")}</button>
            <button type="button" className="btn ghost" onClick={onWrite}>{t("growth.nfcWriteAnother")}</button>
          </div>
        </>
      );
    case "verifying":
      return (
        <>
          <div className="notice" role="status" aria-live="polite"><Icon name="tap" /><div className="grow"><b>{t("growth.nfcHoldVerify")}</b>{t("growth.nfcHoldVerifyText")}</div></div>
          <button type="button" className="btn ghost" onClick={onCancel}>{t("common.cancel")}</button>
        </>
      );
    case "verified":
      return (
        <>
          <div className="notice" role="status" aria-live="polite"><Icon name="check" /><div className="grow"><b>{t("growth.nfcVerified")}</b>{t("growth.nfcVerifiedText")}</div></div>
          <button type="button" className="btn ghost" onClick={onReset}>{t("growth.nfcWriteAnother")}</button>
        </>
      );
    case "mismatch":
      return (
        <>
          <div className="notice warn" role="alert">
            <Icon name="alert" />
            <div className="grow"><b>{t("growth.nfcMismatch")}</b>{t("growth.nfcMismatchText")}<div className="ltr" style={{ overflowWrap: "anywhere" }}>{state.found || "-"}</div></div>
          </div>
          <div className="row">
            <button type="button" className="btn" onClick={onWrite}>{t("growth.nfcWriteAgain")}</button>
            <button type="button" className="btn ghost" onClick={onVerify}>{t("growth.nfcVerify")}</button>
          </div>
          <span className="hint ltr" style={{ overflowWrap: "anywhere" }}>{url}</span>
        </>
      );
    case "error":
      return (
        <>
          <div className="notice bad" role="alert"><Icon name="alert" /><div className="grow"><b>{state.during === "write" ? t("growth.nfcWriteFailed") : t("growth.nfcVerifyFailed")}</b>{t(ERRORS[state.code])}</div></div>
          <div className="row">
            <button type="button" className="btn" onClick={state.during === "write" ? onWrite : onVerify}>{t("common.retry")}</button>
            <button type="button" className="btn ghost" onClick={onReset}>{t("common.cancel")}</button>
          </div>
        </>
      );
  }
}
