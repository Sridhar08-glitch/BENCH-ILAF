"use client";

// The request form. Signed-in people send it with their account (optional screenshot, the page context shown openly);
// visitors on /contact give a name and an e-mail and pass a small proof of work. Nothing leaves before they press send.
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { supportApi } from "@/lib/support/api";
import { captureContext } from "@/lib/support/context";
import { solveChallenge } from "@/lib/support/pow";
import { CATEGORIES, type Category, type SupportContext, type TicketDetail } from "@/lib/support/types";
import { checkFiles, validateTicket, type FormErrorKey } from "@/lib/support/validation";
import { tk, type MessageKey } from "@/lib/i18n";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import { CATEGORY_KEYS, ContextBox, FilePicker } from "./shared";
import s from "./support.module.css";

const ERR_KEYS: Record<FormErrorKey, MessageKey> = {
  subjectRequired: tk("support.err.subjectRequired"),
  subjectLong: tk("support.err.subjectLong"),
  bodyRequired: tk("support.err.bodyRequired"),
  bodyLong: tk("support.err.bodyLong"),
  categoryRequired: tk("support.err.categoryRequired"),
  nameRequired: tk("support.err.nameRequired"),
  emailInvalid: tk("support.err.emailInvalid"),
  tooManyFiles: tk("support.err.tooManyFiles"),
  fileTooBig: tk("support.err.fileTooBig"),
  fileType: tk("support.err.fileType"),
};

export interface Prefill { category?: Category; subject?: string; report?: boolean; from?: string }
export type Sent = { kind: "member"; ticket: TicketDetail } | { kind: "visitor"; label: string; email: string };

export function TicketForm({ visitor, prefill, workspaceId, onSent }: { visitor: boolean; prefill?: Prefill; workspaceId?: string; onSent: (r: Sent) => void }) {
  const { t, locale } = useI18n();
  const [category, setCategory] = useState<string>(prefill?.category ?? "");
  const [subject, setSubject] = useState(prefill?.subject ?? "");
  const [body, setBody] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [fileErr, setFileErr] = useState<ReturnType<typeof checkFiles>>(null);
  const [attach, setAttach] = useState(true);
  const [ctx, setCtx] = useState<SupportContext>({});
  const [errors, setErrors] = useState<ReturnType<typeof validateTicket>>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [website, setWebsite] = useState("");
  const proof = useRef<{ challenge: string; counter: number; readyAt: number } | null>(null);
  const [proofState, setProofState] = useState<"working" | "ready" | "failed">(visitor ? "working" : "ready");

  useEffect(() => {
    setCtx(captureContext({ language: locale, workspaceId, pathname: prefill?.from }));
  }, [locale, workspaceId, prefill?.from]);

  // Visitors: ask for a challenge as the page opens and solve it while they write.
  useEffect(() => {
    if (!visitor) return;
    const flag = { cancelled: false };
    void (async () => {
      try {
        const c = await supportApi.challenge();
        const counter = await solveChallenge(c.challenge, c.difficulty, 200, flag);
        if (counter === null) return;
        proof.current = { challenge: c.challenge, counter, readyAt: Date.now() + c.min_wait * 1000 + 300 };
        setProofState("ready");
      } catch {
        if (!flag.cancelled) setProofState("failed");
      }
    })();
    return () => { flag.cancelled = true; };
  }, [visitor]);

  const fieldErr = (k: keyof typeof errors) => errors[k] && <span className="err" role="alert">{t(ERR_KEYS[errors[k] as FormErrorKey])}</span>;
  const lines = ctx;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const found = validateTicket({ category, subject, body, name, email }, visitor);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setFailure("");
    try {
      const context = attach ? lines : undefined;
      if (visitor) {
        const p = proof.current;
        if (!p) { setFailure(t("support.checkFailed")); return; }
        const wait = p.readyAt - Date.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        const made = await supportApi.contact({ name: name.trim(), email: email.trim(), category, subject: subject.trim(), body: body.trim(), challenge: p.challenge, counter: p.counter, website, context });
        onSent({ kind: "visitor", label: made.label, email: email.trim() });
      } else {
        const made = await supportApi.create({ category, subject: subject.trim(), body: body.trim(), include_context: attach, context, workspace_id: workspaceId, files });
        onSent({ kind: "member", ticket: made });
      }
    } catch (x) {
      setFailure(apiErrorText(x, t, "support.err.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="pane" onSubmit={(e) => void submit(e)} noValidate style={{ gap: 14, maxWidth: 680, position: "relative" }}>
      {prefill?.report && <div className="notice" role="note"><Icon name="alert" /><div className="grow">{t("support.reportHint", { page: prefill.from || "/app" })}</div></div>}
      {visitor && (
        <div className="g2">
          <label className="fg">
            <b>{t("support.fName")}</b>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="name" aria-invalid={!!errors.name} />
            {fieldErr("name")}
          </label>
          <label className="fg">
            <b>{t("support.fEmail")}</b>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} autoComplete="email" dir="ltr" aria-invalid={!!errors.email} />
            {fieldErr("email")}
          </label>
        </div>
      )}
      {visitor && <span className="hint">{t("support.fEmailHint")}</span>}
      <label className="fg">
        <b>{t("support.fCategory")}</b>
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-invalid={!!errors.category}>
          <option value="">{t("support.fCategoryPick")}</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{t(CATEGORY_KEYS[c])}</option>)}
        </select>
        {fieldErr("category")}
      </label>
      <label className="fg">
        <b>{t("support.fSubject")}</b>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t("support.fSubjectPh")} maxLength={200} aria-invalid={!!errors.subject} />
        {fieldErr("subject")}
      </label>
      <label className="fg">
        <b>{t("support.fMessage")}</b>
        <textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t("support.fMessagePh")} maxLength={10000} aria-invalid={!!errors.body} />
        {fieldErr("body")}
      </label>
      {!visitor && (
        <>
          <FilePicker files={files} onChange={setFiles} onError={setFileErr} label={t("support.fFiles")} hint={t("support.fFilesHint")} />
          {fileErr && <span className="err" role="alert">{t(ERR_KEYS[fileErr])}</span>}
        </>
      )}
      <div className="notice warn" role="note"><Icon name="lock" /><div className="grow">{t("support.noPasswords")}</div></div>
      <ContextBox ctx={lines} on={attach} onToggle={setAttach} />
      {/* A field no person sees: robots fill it in and are refused. */}
      {visitor && (
        <div className={s.trap} aria-hidden="true">
          <label>{t("support.honeypot")}<input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} name="website" /></label>
        </div>
      )}
      {visitor && proofState === "working" && <span className="hint" role="status">{t("support.checking")}</span>}
      {visitor && proofState === "failed" && <span className="err" role="alert">{t("support.checkFailed")}</span>}
      {failure && <div className="notice bad" role="alert"><Icon name="alert" /><div className="grow">{failure}</div></div>}
      <div><button className="btn" disabled={busy || (visitor && proofState === "failed")}>{busy ? t("support.sending") : t("support.send")}</button></div>
    </form>
  );
}
