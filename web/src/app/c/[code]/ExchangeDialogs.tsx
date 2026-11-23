"use client";

// The two forms a visitor can fill in on a card page: "Share your details" (exchange contact) and
// "Request a meeting" (the built-in booking request). Both send a hidden honeypot field, the time the form
// was opened, and the visitor's consent; the API refuses forms sent too fast and caps messages per address.
import { APP_NAME } from "@/lib/config";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import styles from "./PublicCard.module.css";
import x from "./Exchange.module.css";
import { Icon } from "@/components/Icon";
import { sendLead, sendMeetingRequest } from "@/lib/public-api";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import type { TFunction } from "@/lib/i18n";
import type { EventSource, FieldMode, PublicFeatures } from "@/lib/types";

/** Fields the form shows, in order, with their mode. Email and phone are "optional" together means one of them is needed. */
export function exchangeRows(fields: PublicFeatures["exchange"]["fields"]): { key: "email" | "phone" | "company" | "note"; mode: FieldMode }[] {
  return (["email", "phone", "company", "note"] as const).filter((k) => fields[k] !== "off").map((k) => ({ key: k, mode: fields[k] }));
}

/** The first problem with an exchange form, in plain words, or null. */
export function exchangeProblem(t: TFunction, form: { name: string; email: string; phone: string; company: string; note: string }, fields: PublicFeatures["exchange"]["fields"]): string | null {
  if (!form.name.trim()) return t("card.errName");
  if (form.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) return t("card.errEmail");
  for (const { key, mode } of exchangeRows(fields)) {
    if (mode === "required" && !form[key].trim()) {
      const field = key === "note" ? t("card.fieldMessage") : key === "email" ? t("card.fieldEmail") : key === "phone" ? t("card.fieldPhone") : t("card.fieldCompany");
      return t("card.errFillIn", { field });
    }
  }
  if (fields.email === "optional" && fields.phone === "optional" && !form.email.trim() && !form.phone.trim()) {
    return t("card.errEmailOrPhone");
  }
  return null;
}

function useDialogKeys(onClose: () => void) {
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return first;
}

function Consent({ id, text, privacyUrl, checked, onChange }: { id: string; text: string; privacyUrl?: string | null; checked: boolean; onChange: (v: boolean) => void }) {
  const { t } = useI18n();
  return (
    <label className={x.check} htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {text}
        {privacyUrl && (
          <>
            {" "}
            <a href={privacyUrl} target="_blank" rel="noopener noreferrer">{t("card.privacyPolicy")}</a>
          </>
        )}
      </span>
    </label>
  );
}

/** A short notice under the consent box: where the details go and where to read how they are handled. */
function PrivacyNote({ privacyUrl }: { privacyUrl?: string | null }) {
  const { t } = useI18n();
  return (
    <p className={x.fine}>
      {t("card.formNotice")}{" "}
      <a href={privacyUrl || "/privacy"} target="_blank" rel="noopener noreferrer">
        {privacyUrl ? t("card.noticeOwner") : t("card.noticeApp", { app: APP_NAME })}
      </a>
    </p>
  );
}

function Honeypot({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  return (
    <div className={styles.hp} aria-hidden="true">
      <label>
        {t("card.formWebsite")}
        <input tabIndex={-1} autoComplete="off" name="website_url" value={value} onChange={(e) => onChange(e.target.value)} />
      </label>
    </div>
  );
}

function Shell({ id, title, onClose, onSubmit, children }: { id: string; title: string; onClose: () => void; onSubmit?: (e: FormEvent) => void; children: ReactNode }) {
  return (
    <div className={styles.modal} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={id} onSubmit={onSubmit} noValidate>
        <h2 id={id}>{title}</h2>
        {children}
      </form>
    </div>
  );
}

function Done({ title, text, saveName, vcardUrl, onClose }: { title: string; text: string; saveName?: string; vcardUrl?: string; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <div className={styles.modal} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="done-title">
        <div className={x.success}>
          <span className={x.tick} aria-hidden="true"><Icon name="check" size="l" /></span>
          <h2 id="done-title">{title}</h2>
          <p>{text}</p>
          {vcardUrl && saveName && (
            <a className={x.save} href={vcardUrl} download>
              <Icon name="download" size="s" /> {t("card.saveTheirContact", { name: saveName })}
            </a>
          )}
          <button type="button" className="btn ghost" onClick={onClose} autoFocus={!vcardUrl}>{t("card.close")}</button>
        </div>
      </div>
    </div>
  );
}

interface ExchangeProps {
  code: string;
  source: EventSource | null;
  name: string;
  features: PublicFeatures["exchange"];
  vcardUrl: string;
  /** The preview page: the form can be filled in and sent, but nothing leaves the browser. */
  preview?: boolean;
  onClose: () => void;
}

export function ExchangeDialog({ code, source, name, features, vcardUrl, preview, onClose }: ExchangeProps) {
  const { t } = useI18n();
  const [form, setForm] = useState({ name: "", email: "", phone: "", company: "", note: "", website_url: "" });
  const [consent, setConsent] = useState(false);
  const [sendMine, setSendMine] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const opened = useRef(Date.now());
  const first = useDialogKeys(onClose);
  const rows = exchangeRows(features.fields);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const mark = (mode: FieldMode) => (mode === "required" ? <span className={x.req} aria-hidden="true"> *</span> : null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = exchangeProblem(t, form, features.fields) ?? (consent ? null : t("card.errConsent"));
    if (problem) return setError(problem);
    setBusy(true);
    setError("");
    if (preview) {
      setDone(true);
      return;
    }
    try {
      const sent = await sendLead(code, {
        name: form.name.trim(),
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        company: form.company.trim() || undefined,
        note: form.note.trim() || undefined,
        consent: true,
        opened_at: opened.current,
        source,
        website_url: form.website_url,
      });
      setDone(true);
      // "Send me yours": the owner's contact file is handed over straight away.
      const href = sent.vcard_url || vcardUrl;
      if (sendMine && href) {
        const a = document.createElement("a");
        a.href = href;
        a.download = "";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch (err) {
      setError(apiErrorText(err, t, "card.sendFailed"));
      setBusy(false);
    }
  }

  if (done) {
    return <Done title={t("card.thanksTitle")} text={t("card.thanksText", { name })} saveName={name} vcardUrl={vcardUrl} onClose={onClose} />;
  }
  return (
    <Shell id="lead-title" title={t("card.shareTitle", { name })} onClose={onClose} onSubmit={submit}>
      {preview && <p className={x.fine} role="note"><b>{t("card.previewNote")}</b></p>}
      <p>{t("card.shareIntro")}</p>
      <label>
        <span>{t("card.formName")}{mark("required")}</span>
        <input ref={first} value={form.name} onChange={set("name")} autoComplete="name" required />
      </label>
      <div className="two">
        {rows.filter((r) => r.key === "email" || r.key === "phone").map(({ key, mode }) => (
          <label key={key}>
            <span>{key === "email" ? t("card.formEmail") : t("card.formPhone")}{mark(mode)}</span>
            <input type={key === "email" ? "email" : "tel"} value={form[key]} onChange={set(key)} autoComplete={key === "email" ? "email" : "tel"} />
          </label>
        ))}
      </div>
      {rows.some((r) => r.key === "company") && (
        <label>
          <span>{t("card.formCompany")}{mark(features.fields.company)}</span>
          <input value={form.company} onChange={set("company")} autoComplete="organization" />
        </label>
      )}
      {rows.some((r) => r.key === "note") && (
        <label>
          <span>{t("card.formMessage")}{mark(features.fields.note)}</span>
          <textarea value={form.note} onChange={set("note")} maxLength={500} />
        </label>
      )}
      <Honeypot value={form.website_url} onChange={(v) => setForm((f) => ({ ...f, website_url: v }))} />
      <Consent id="lead-consent" text={features.consent_text} privacyUrl={features.privacy_url} checked={consent} onChange={setConsent} />
      <PrivacyNote privacyUrl={features.privacy_url} />
      <label className={x.check} htmlFor="lead-mine">
        <input id="lead-mine" type="checkbox" checked={sendMine} onChange={(e) => setSendMine(e.target.checked)} />
        <span>{t("card.alsoSave", { name })}</span>
      </label>
      {error && <p className="err" role="alert">{error}</p>}
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button type="button" className="btn ghost" onClick={onClose}>{t("common.cancel")}</button>
        <button type="submit" className="btn" disabled={busy}>{busy ? t("card.sending") : t("card.send")}</button>
      </div>
    </Shell>
  );
}

interface MeetingProps {
  code: string;
  source: EventSource | null;
  name: string;
  features: PublicFeatures["exchange"];
  onClose: () => void;
}

export function MeetingDialog({ code, source, name, features, onClose }: MeetingProps) {
  const { t } = useI18n();
  const [form, setForm] = useState({ name: "", email: "", message: "", website_url: "" });
  const [times, setTimes] = useState(["", "", ""]);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const opened = useRef(Date.now());
  const first = useDialogKeys(onClose);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const chosen = times.map((v) => v.trim()).filter(Boolean);
    if (!form.name.trim()) return setError(t("card.errName"));
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) return setError(t("card.errEmail"));
    if (chosen.length === 0) return setError(t("card.errTimes"));
    if (!consent) return setError(t("card.errConsent"));
    setBusy(true);
    setError("");
    try {
      await sendMeetingRequest(code, {
        name: form.name.trim(), email: form.email.trim(), times: chosen, message: form.message.trim() || undefined,
        consent: true, opened_at: opened.current, source, website_url: form.website_url,
      });
      setDone(true);
    } catch (err) {
      setError(apiErrorText(err, t, "card.sendFailed"));
      setBusy(false);
    }
  }

  if (done) return <Done title={t("card.requestSent")} text={t("card.requestSentText", { name })} onClose={onClose} />;
  return (
    <Shell id="meet-title" title={t("card.meetTitle", { name })} onClose={onClose} onSubmit={submit}>
      <p>{t("card.meetIntro")}</p>
      <label>
        <span>{t("card.formName")}<span className={x.req} aria-hidden="true"> *</span></span>
        <input ref={first} value={form.name} onChange={set("name")} autoComplete="name" dir="auto" required />
      </label>
      <label>
        <span>{t("card.formEmail")}<span className={x.req} aria-hidden="true"> *</span></span>
        <input type="email" value={form.email} onChange={set("email")} autoComplete="email" required />
      </label>
      <fieldset className={x.times} style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>{t("card.timesLegend")}<span className={x.req} aria-hidden="true"> *</span></legend>
        {times.map((value, i) => (
          <div className={x.timeRow} key={i}>
            <input
              value={value}
              maxLength={80}
              placeholder={i === 0 ? t("card.timePlaceholder1") : i === 1 ? t("card.timePlaceholder2") : t("card.timePlaceholder3")}
              aria-label={t("card.timeAria", { n: i + 1 })}
              onChange={(e) => setTimes((all) => all.map((v, k) => (k === i ? e.target.value : v)))}
            />
          </div>
        ))}
      </fieldset>
      <label>
        {t("card.formMessage")}
        <textarea value={form.message} onChange={set("message")} maxLength={500} />
      </label>
      <Honeypot value={form.website_url} onChange={(v) => setForm((f) => ({ ...f, website_url: v }))} />
      <Consent id="meet-consent" text={features.consent_text} privacyUrl={features.privacy_url} checked={consent} onChange={setConsent} />
      <PrivacyNote privacyUrl={features.privacy_url} />
      {error && <p className="err" role="alert">{error}</p>}
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button type="button" className="btn ghost" onClick={onClose}>{t("common.cancel")}</button>
        <button type="submit" className="btn" disabled={busy}>{busy ? t("card.sending") : t("card.sendRequestButton")}</button>
      </div>
    </Shell>
  );
}
