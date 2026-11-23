"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/Icon";
import { ErrorBox, PageHead, SkeletonBlocks, useToast } from "@/components/app/ui";
import { useWs } from "@/components/app/WorkspaceContext";
import { Weave, slot } from "@/components/ops/shared";
import { api } from "@/lib/api";
import { toApiItems } from "@/lib/card/buttons";
import { keys, useCard } from "@/lib/hooks";
import { tk, type MessageKey } from "@/lib/i18n";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import { IMAGE_ACCEPT, isAllowedImage } from "@/lib/images";
import { loadTesseractEngine, ocrFilesPresent, prepareImage, type OcrEngine, type OcrProgress } from "@/lib/scan/ocr";
import { parseCardText, type Confidence, type FieldKey, type ParsedCard } from "@/lib/scan/parse";
import { EMPTY_FIELDS, FILL_LABELS, applyFill, fillChanges, scanLead, scanVcard, type FillChange, type ScanFields } from "@/lib/scan/actions";
import type { Card } from "@/lib/types";

export default function ScanPage() {
  return (
    <Suspense fallback={<div className="view"><SkeletonBlocks rows={3} /></div>}>
      <ScanInner />
    </Suspense>
  );
}

type Stage = "start" | "reading" | "review";
type Engine = "checking" | "ready" | "missing";

function fieldsFrom(p: ParsedCard): ScanFields {
  const list = (a: string[]) => (a.length ? a : [""]);
  return {
    name: p.name, title: p.title, company: p.company, phones: list(p.phones.map((x) => x.value)), emails: list(p.emails), websites: list(p.websites),
    address: p.address, social: p.social.map((s) => s.url || `@${s.handle}`),
  };
}

function ScanInner() {
  const { current } = useWs();
  const toast = useToast();
  const { t } = useI18n();
  const qc = useQueryClient();
  const cardId = useSearchParams().get("card") ?? "";
  const card = useCard(cardId);
  const [engine, setEngine] = useState<Engine>("checking");
  const [stage, setStage] = useState<Stage>("start");
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [parsed, setParsed] = useState<ParsedCard | null>(null);
  const [fields, setFields] = useState<ScanFields>(EMPTY_FIELDS);
  const [error, setError] = useState("");
  const [diff, setDiff] = useState<FillChange[] | null>(null);
  const [busy, setBusy] = useState(false);
  const engineRef = useRef<OcrEngine | null>(null);
  const takeRef = useRef<HTMLInputElement>(null);
  const pickRef = useRef<HTMLInputElement>(null);

  // Only the check for the engine's files runs on load. The engine itself is loaded when a photo is chosen.
  useEffect(() => {
    let live = true;
    void ocrFilesPresent().then((ok) => live && setEngine(ok ? "ready" : "missing"));
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => () => {
    void engineRef.current?.dispose();
    engineRef.current = null;
  }, []);
  useEffect(() => () => {
    if (image) URL.revokeObjectURL(image);
  }, [image]);

  function review(text: string) {
    const p = parseCardText(text);
    setParsed(p);
    setFields(fieldsFrom(p));
    setStage("review");
  }

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    if (!isAllowedImage(file)) return setError(t("common.useImage"));
    setError("");
    setImage(URL.createObjectURL(file));
    if (engine !== "ready") {
      setError(t("tools.scanReaderMissingPaste"));
      return;
    }
    setStage("reading");
    setProgress({ stage: "loading", progress: 0 });
    try {
      if (!engineRef.current) engineRef.current = await loadTesseractEngine((p) => setProgress(p));
      if (!engineRef.current) {
        setEngine("missing");
        setStage("start");
        setError(t("tools.scanReaderFailed"));
        return;
      }
      const prepared = await prepareImage(file);
      const result = await engineRef.current.recognize(prepared, (p) => setProgress(p));
      if (!result.text.trim()) {
        setStage("start");
        setError(t("tools.scanNoText"));
        return;
      }
      review(result.text);
    } catch {
      setStage("start");
      setError(t("tools.scanReadFailed"));
    } finally {
      setProgress(null);
      if (takeRef.current) takeRef.current.value = "";
      if (pickRef.current) pickRef.current.value = "";
    }
  }

  function setList(key: "phones" | "emails" | "websites" | "social", i: number, value: string) {
    setFields((f) => ({ ...f, [key]: f[key].map((v, k) => (k === i ? value : v)) }));
  }
  function addRow(key: "phones" | "emails" | "websites" | "social") {
    setFields((f) => ({ ...f, [key]: [...f[key], ""] }));
  }
  function removeRow(key: "phones" | "emails" | "websites" | "social", i: number) {
    setFields((f) => ({ ...f, [key]: f[key].filter((_, k) => k !== i) }));
  }

  function saveVcard() {
    const text = scanVcard(fields, { note: t("tools.vcardNote"), social: t("tools.vcardSocial") });
    if (!text) return toast(t("tools.scanNameFirstContact"));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/vcard;charset=utf-8" }));
    a.download = `${fields.name.trim().replace(/[^\w-]+/g, "-").toLowerCase() || "contact"}.vcf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function createLead() {
    if (!fields.name.trim()) return toast(t("tools.scanNameFirst"));
    setBusy(true);
    try {
      await api.addLead(current.id, { ...scanLead(fields, t), ...(cardId ? { card_id: cardId } : {}) });
      void qc.invalidateQueries({ queryKey: ["leads", current.id] });
      toast(t("tools.scanSavedContacts"));
    } catch (e) {
      toast(apiErrorText(e, t, "tools.scanSaveFailed"));
    } finally {
      setBusy(false);
    }
  }

  function askFill() {
    if (!card.data) return;
    const changes = fillChanges({ name: card.data.name, title: card.data.title, company: card.data.company, items: card.data.items }, fields);
    if (changes.length === 0) return toast(t("tools.scanNothingToChange"));
    setDiff(changes);
  }

  async function confirmFill(accepted: FillChange[]) {
    const c = card.data as Card;
    setBusy(true);
    try {
      const next = applyFill({ name: c.name, title: c.title, company: c.company, items: c.items }, accepted);
      const saved = await api.updateCard(c.id, { name: next.name, title: next.title, company: next.company, items: toApiItems(next.items) });
      qc.setQueryData(keys.card(c.id), saved);
      setDiff(null);
      toast(saved.submitted_for_approval?.length ? t("tools.scanSentApproval") : t("tools.scanCardUpdated"));
    } catch (e) {
      setDiff(null);
      toast(apiErrorText(e, t, "tools.scanUpdateFailed"));
    } finally {
      setBusy(false);
    }
  }

  const percent = Math.round((progress?.progress ?? 0) * 100);

  return (
    <div className="view">
      <PageHead title={t("tools.scanTitle")} sub={t("tools.scanSub")}>
        {cardId && card.data && <Link className="btn ghost" href={`/app/cards/${cardId}`}>{t("tools.scanBack")}</Link>}
      </PageHead>

      {engine === "missing" && (
        <div className="notice warn" role="status">
          <Icon name="alert" />
          <div className="grow">
            <b>{t("tools.scanNotInstalled")}</b>
            <Weave
              text={t("tools.scanNotInstalledText", { install: slot(0), copy: slot(1) })}
              nodes={[<code key="i" className="ltr">npm install</code>, <code key="c" className="ltr">npm run copy:ocr</code>]}
            />
          </div>
        </div>
      )}
      {error && <div className="notice bad" role="alert"><Icon name="alert" /><div className="grow">{error}</div></div>}

      {stage !== "review" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,360px),1fr))", gap: 20, alignItems: "start" }}>
          <div className="panel card">
            <div className="head"><h2><span className="chip"><Icon name="camera" size="s" /></span>{t("tools.scanPhotoHeading")}</h2></div>
            <input ref={takeRef} type="file" accept={IMAGE_ACCEPT} capture="environment" hidden id="scan-take" onChange={(e) => void onPhoto(e.target.files?.[0])} />
            <input ref={pickRef} type="file" accept={IMAGE_ACCEPT} hidden id="scan-pick" onChange={(e) => void onPhoto(e.target.files?.[0])} />
            <div className="row">
              <button type="button" className="btn" disabled={stage === "reading" || engine === "checking"} onClick={() => takeRef.current?.click()}><Icon name="camera" size="s" />{t("tools.scanTake")}</button>
              <button type="button" className="btn ghost" disabled={stage === "reading" || engine === "checking"} onClick={() => pickRef.current?.click()}><Icon name="upload" size="s" />{t("tools.scanChoose")}</button>
            </div>
            <div className="hint">{t("tools.scanTip")}</div>
            {image && <img src={image} alt={t("tools.scanChosenAlt")} style={{ maxWidth: "100%", maxHeight: 280, objectFit: "contain", borderRadius: 10, border: "1px solid var(--line)" }} />}
            {stage === "reading" && (
              <div role="status" aria-live="polite">
                <div className="hint">{progress?.stage === "reading" ? t("tools.scanReading", { percent }) : t("tools.scanLoadingReader", { percent })}</div>
                <div style={{ height: 6, background: "var(--surface-2)", borderRadius: 3, overflow: "hidden", marginTop: 6 }}>
                  <div style={{ width: `${percent}%`, height: "100%", background: "var(--orange)", transition: "width .2s" }} />
                </div>
              </div>
            )}
          </div>

          <div className="panel card">
            <div className="head"><h2><span className="chip"><Icon name="copy" size="s" /></span>{t("tools.scanPasteHeading")}</h2></div>
            <label>
              {t("tools.scanTextFromCard")}
              <textarea rows={8} dir="auto" value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder={t("tools.scanPastePh")} />
            </label>
            <div className="row">
              <button type="button" className="btn" disabled={!pasted.trim()} onClick={() => { setError(""); review(pasted); }}>{t("tools.scanReadText")}</button>
            </div>
          </div>
        </div>
      )}

      {stage === "review" && parsed && (
        <Review
          parsed={parsed}
          fields={fields}
          setFields={setFields}
          image={image}
          setList={setList}
          addRow={addRow}
          removeRow={removeRow}
          onVcard={saveVcard}
          onLead={() => void createLead()}
          onFill={cardId ? askFill : undefined}
          fillReady={!!card.data}
          fillError={cardId && card.error ? card.error : null}
          busy={busy}
          onAgain={() => { setStage("start"); setParsed(null); setImage(null); setPasted(""); setError(""); }}
        />
      )}

      {diff && card.data && <FillDialog name={card.data.name} changes={diff} busy={busy} onCancel={() => setDiff(null)} onConfirm={(c) => void confirmFill(c)} />}
    </div>
  );
}

const HINTS: Record<Confidence, { text: MessageKey; cls: string }> = {
  high: { text: tk("tools.scanLooksRight"), cls: "ok" },
  medium: { text: tk("tools.scanCheckThis"), cls: "warn" },
  low: { text: tk("tools.scanBestGuess"), cls: "warn" },
  none: { text: tk("tools.scanNotFound"), cls: "" },
};

function Hint({ c, field }: { c: ParsedCard["confidence"]; field: FieldKey }) {
  const { t } = useI18n();
  const h = HINTS[c[field]];
  return <span className={`pill ${h.cls}`} style={{ marginInlineStart: 8, fontSize: 11 }}>{t(h.text)}</span>;
}

type ListKey = "phones" | "emails" | "websites" | "social";

interface ReviewProps {
  parsed: ParsedCard;
  fields: ScanFields;
  setFields: React.Dispatch<React.SetStateAction<ScanFields>>;
  image: string | null;
  setList: (k: ListKey, i: number, v: string) => void;
  addRow: (k: ListKey) => void;
  removeRow: (k: ListKey, i: number) => void;
  onVcard: () => void;
  onLead: () => void;
  onFill?: () => void;
  fillReady: boolean;
  fillError: unknown;
  busy: boolean;
  onAgain: () => void;
}

function Review({ parsed, fields, setFields, image, setList, addRow, removeRow, onVcard, onLead, onFill, fillReady, fillError, busy, onAgain }: ReviewProps) {
  const { t } = useI18n();
  const text = (key: "name" | "title" | "company" | "address", label: string, field: FieldKey, alt?: string) => (
    <label>
      <span>{label}<Hint c={parsed.confidence} field={field} /></span>
      {key === "address" ? (
        <textarea rows={2} dir="auto" value={fields.address} onChange={(e) => setFields((f) => ({ ...f, address: e.target.value }))} />
      ) : (
        <input dir="auto" value={fields[key]} onChange={(e) => setFields((f) => ({ ...f, [key]: e.target.value }))} autoComplete="off" />
      )}
      {alt && alt !== fields[key] && (
        <span className="hint">{t("tools.scanAlsoOnCard")} <button type="button" className="linkbtn" onClick={() => setFields((f) => ({ ...f, [key]: alt }))}>{t("tools.scanUseAlt", { alt })}</button></span>
      )}
    </label>
  );
  const list = (key: ListKey, label: string, field: FieldKey, type: string, placeholder: string) => (
    <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <legend style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{label}<Hint c={parsed.confidence} field={field} /></legend>
      {fields[key].map((v, i) => (
        <div key={i} style={{ display: "flex", gap: 6 }}>
          <input type={type} className="ltr" value={v} placeholder={placeholder} aria-label={t("tools.scanFieldN", { label, n: i + 1 })} onChange={(e) => setList(key, i, e.target.value)} autoComplete="off" style={{ flex: 1, minWidth: 0 }} />
          {(fields[key].length > 1 || v) && <button type="button" className="x del" aria-label={t("tools.scanRemoveField", { label, n: i + 1 })} onClick={() => removeRow(key, i)}><Icon name="x2" size="s" /></button>}
        </div>
      ))}
      <button type="button" className="linkbtn" style={{ alignSelf: "flex-start", fontSize: 12 }} onClick={() => addRow(key)}>{t("tools.scanAddAnother")}</button>
    </fieldset>
  );
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,420px),1fr))", gap: 20, alignItems: "start" }}>
      <div className="panel card">
        <div className="head"><h2><span className="chip"><Icon name="check" size="s" /></span>{t("tools.scanCheckDetails")}</h2><button type="button" className="btn ghost sm" onClick={onAgain}>{t("tools.scanAnother")}</button></div>
        <div className="hint">{t("tools.scanCheckHint")}</div>
        <div className="two">
          {text("name", t("common.name"), "name", parsed.alt.name)}
          {text("title", t("tools.scanFieldTitle"), "title", parsed.alt.title)}
        </div>
        {text("company", t("tools.scanFieldCompany"), "company", parsed.alt.company)}
        <div className="two">
          {list("phones", t("tools.scanFieldPhone"), "phone", "tel", "+974 5555 1234")}
          {list("emails", t("common.email"), "email", "email", "name@company.com")}
        </div>
        {list("websites", t("tools.scanFieldWebsite"), "website", "text", "company.com")}
        {text("address", t("tools.scanFieldAddress"), "address")}
        {list("social", t("tools.scanFieldSocial"), "social", "text", "https://linkedin.com/in/name")}
        {parsed.leftover.length > 0 && <div className="hint" dir="auto">{t("tools.scanLeftover", { lines: parsed.leftover.join(" | ") })}</div>}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        <div className="panel card">
          <div className="head"><h2><span className="chip"><Icon name="adduser" size="s" /></span>{t("tools.scanWhatNow")}</h2></div>
          <button type="button" className="btn" onClick={onVcard}><Icon name="download" size="s" />{t("tools.scanSaveVcard")}</button>
          <button type="button" className="btn ghost" disabled={busy} onClick={onLead}><Icon name="users" size="s" />{t("tools.scanCreateLead")}</button>
          {onFill && (
            <button type="button" className="btn ghost" disabled={busy || !fillReady} onClick={onFill}><Icon name="card" size="s" />{t("tools.scanFillCard")}</button>
          )}
          {onFill && !fillReady && !fillError && <div className="hint">{t("tools.scanLoadingCard")}</div>}
          {fillError ? <ErrorBox error={fillError} /> : null}
          <div className="hint">{t("tools.scanWhatNowHint")}{onFill ? ` ${t("tools.scanFillHint")}` : ""}</div>
        </div>
        {image && <img src={image} alt={t("tools.scanScannedAlt")} style={{ maxWidth: "100%", borderRadius: 10, border: "1px solid var(--line)" }} />}
      </div>
    </div>
  );
}

function FillDialog({ name, changes, busy, onCancel, onConfirm }: { name: string; changes: FillChange[]; busy: boolean; onCancel: () => void; onConfirm: (c: FillChange[]) => void }) {
  const { t } = useI18n();
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(changes.map((c) => [c.field, true])));
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onCancel]);
  const picked = changes.filter((c) => on[c.field]);
  return (
    <div className="modal-back" role="presentation" onClick={(e) => e.target === e.currentTarget && onCancel()} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,.45)", display: "grid", placeItems: "center", padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-labelledby="fill-title" className="panel card" style={{ background: "#fff", maxWidth: 520, width: "100%", maxHeight: "90dvh", overflowY: "auto" }}>
        <div className="head"><h2 id="fill-title">{name ? t("tools.scanFillTitleName", { name }) : t("tools.scanFillTitle")}</h2></div>
        <div className="hint">{t("tools.scanFillTick")}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {changes.map((c) => (
            <label key={c.field} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start", border: "1px solid var(--line)", borderRadius: 10, padding: 10, cursor: "pointer" }}>
              <input className="chk" type="checkbox" checked={!!on[c.field]} onChange={(e) => setOn((o) => ({ ...o, [c.field]: e.target.checked }))} />
              <span style={{ minWidth: 0 }}>
                <b>{t(FILL_LABELS[c.field])}</b>
                <span dir="auto" style={{ display: "block", color: "#B42318", textDecoration: c.from ? "line-through" : "none", overflowWrap: "anywhere" }}>{c.from || t("tools.scanFillEmpty")}</span>
                <span dir="auto" style={{ display: "block", color: "#067647", overflowWrap: "anywhere" }}>{c.to}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button ref={first} type="button" className="btn ghost" onClick={onCancel}>{t("common.cancel")}</button>
          <button type="button" className="btn" disabled={busy || picked.length === 0} onClick={() => onConfirm(picked)}>{busy ? t("common.saving") : t("tools.scanFillUpdate", { n: picked.length })}</button>
        </div>
      </div>
    </div>
  );
}
