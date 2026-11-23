"use client";

// Pieces shared by the company's request pages, the public preview and the staff area: status words, the timeline,
// the message thread and the stage that draws a custom face on sample people.
import { useMemo, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { CardView } from "@/components/card/CardView";
import { PERSONAS } from "@/lib/card/arabic-personas";
import { errorText, TIMELINE, type RequestFile, type RequestStatus, type ThreadMessage } from "@/lib/designs/api";
import { useI18n } from "@/lib/i18n/client";
import { tk, type MessageKey } from "@/lib/i18n";
import type { CustomFaceData } from "@/lib/library/custom/types";
import { toCompanyBrand } from "@/lib/library/company/brand";
import { defaultDesign } from "@/lib/library";
import type { CardPageData } from "@/lib/library/types";

export const STATUS_KEYS: Record<RequestStatus, MessageKey> = {
  new: tk("designs.status.new"), contacted: tk("designs.status.contacted"), in_design: tk("designs.status.in_design"), in_review: tk("designs.status.in_review"),
  changes_requested: tk("designs.status.changes_requested"), approved: tk("designs.status.approved"), live: tk("designs.status.live"),
  closed: tk("designs.status.closed"), withdrawn: tk("designs.status.withdrawn"),
};

export function StatusPill({ status }: { status: RequestStatus }) {
  const { t } = useI18n();
  const cls = status === "live" || status === "approved" ? "ok" : status === "in_review" || status === "changes_requested" ? "warn" : status === "closed" || status === "withdrawn" ? "" : "accent";
  return <span className={`pill ${cls}`}>{t(STATUS_KEYS[status])}</span>;
}

/** new, contacted, in design, in review, approved, live: where the request is on that path. */
export function Timeline({ status }: { status: RequestStatus }) {
  const { t } = useI18n();
  const at = status === "changes_requested" ? TIMELINE.indexOf("in_design") : TIMELINE.indexOf(status);
  return (
    <ol className="dtl" aria-label={t("designs.timeline")}>
      {TIMELINE.map((s, i) => (
        <li key={s} className={i < at ? "done" : i === at ? "now" : ""} aria-current={i === at ? "step" : undefined}>
          <i>{i < at ? <Icon name="check" size="s" /> : i + 1}</i>
          <span>{t(STATUS_KEYS[s])}</span>
        </li>
      ))}
      <style>{`.dtl{display:flex;gap:6px;list-style:none;margin:0;padding:0;flex-wrap:wrap}.dtl li{display:flex;align-items:center;gap:8px;padding:6px 12px 6px 6px;border:1px solid var(--line);border-radius:999px;color:var(--mute);font-size:13px}.dtl i{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-style:normal;font-size:11px;background:var(--surface-2)}.dtl .done{color:var(--ok)}.dtl .done i{background:var(--ok-bg)}.dtl .now{color:var(--ink);border-color:var(--ink);font-weight:600}.dtl .now i{background:var(--ink);color:#fff}`}</style>
    </ol>
  );
}

function size(n: number) { return n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`; }

export function FileChip({ f, href }: { f: RequestFile; href: string }) {
  return (
    <a className="pill" href={href} target="_blank" rel="noopener noreferrer" download={f.content_type === "application/pdf" ? f.name : undefined}>
      <Icon name="download" size="s" /> {f.name} <small>{size(f.size)}</small>
    </a>
  );
}

interface ThreadProps {
  messages: ThreadMessage[];
  fileHref: (fileId: string) => string;
  upload: (f: File) => Promise<RequestFile>;
  send: (body: string, fileIds: string[], internal: boolean) => Promise<void>;
  staff?: boolean;
  disabled?: boolean;
  files: RequestFile[];
}

/** The conversation, the status lines in it, and the box to write in (with attachments, and the internal-note switch for staff). */
export function Thread({ messages, fileHref, upload, send, staff, disabled, files }: ThreadProps) {
  const { t, dateTime } = useI18n();
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [pending, setPending] = useState<RequestFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const attached = useMemo(() => new Set(messages.flatMap((m) => m.files.map((f) => f.id))), [messages]);
  const loose = files.filter((f) => !attached.has(f.id) && !pending.some((p) => p.id === f.id));

  async function pick(list: FileList | null) {
    if (!list) return;
    setErr("");
    for (const f of Array.from(list)) {
      try { const row = await upload(f); setPending((p) => [...p, row]); } catch (e) { setErr(errorText(e, t)); }
    }
    if (input.current) input.current.value = "";
  }
  async function submit() {
    if (busy || (!body.trim() && !pending.length)) return;
    setBusy(true); setErr("");
    try { await send(body, pending.map((p) => p.id), internal); setBody(""); setPending([]); } catch (e) { setErr(errorText(e, t)); } finally { setBusy(false); }
  }
  return (
    <div className="pane" style={{ gap: 10 }}>
      {messages.map((m) =>
        m.kind === "status" ? (
          <div key={m.id} className="hint" style={{ textAlign: "center" }}>
            {m.author_kind === "system" ? "" : (m.author_kind === "staff" ? t("designs.byTeam") : t("designs.byYou")) + " · "}
            {t(STATUS_KEYS[m.status_to as RequestStatus] ?? STATUS_KEYS.new)} · {dateTime(m.created_at)}
            {m.body && <div style={{ color: "var(--ink)", marginBlockStart: 2 }}>{m.body}</div>}
          </div>
        ) : (
          <div key={m.id} className="panel" style={{ padding: 12, background: m.internal ? "var(--warn-bg)" : m.author_kind === "staff" ? "var(--tint-blue)" : undefined }}>
            <div className="hint">
              <b style={{ color: "var(--ink)" }}>{m.author_name || t("designs.byTeam")}</b> · {dateTime(m.created_at)}
              {m.internal && <span className="pill warn" style={{ marginInlineStart: 8 }}>{t("designs.internal")}</span>}
            </div>
            <div style={{ whiteSpace: "pre-wrap", marginBlockStart: 4 }}>{m.body}</div>
            {m.files.length > 0 && <div className="row" style={{ marginBlockStart: 8, flexWrap: "wrap" }}>{m.files.map((f) => <FileChip key={f.id} f={f} href={fileHref(f.id)} />)}</div>}
          </div>
        ),
      )}
      {loose.length > 0 && <div className="row" style={{ flexWrap: "wrap" }}><span className="hint">{t("designs.files")}</span>{loose.map((f) => <FileChip key={f.id} f={f} href={fileHref(f.id)} />)}</div>}
      {!disabled && (
        <div className="panel" style={{ padding: 12, display: "grid", gap: 8 }}>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={t("designs.writeMessage")} aria-label={t("designs.writeMessage")} maxLength={5000} />
          {pending.length > 0 && <div className="row" style={{ flexWrap: "wrap" }}>{pending.map((f) => <FileChip key={f.id} f={f} href={fileHref(f.id)} />)}</div>}
          <div className="row" style={{ flexWrap: "wrap" }}>
            <button type="button" className="btn ghost sm" onClick={() => input.current?.click()}><Icon name="upload" size="s" /> {t("designs.attach")}</button>
            <input ref={input} type="file" multiple hidden accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => void pick(e.target.files)} />
            {staff && <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> {t("designs.internalNote")}</label>}
            <span className="grow" />
            <button type="button" className="btn sm" disabled={busy} onClick={() => void submit()}>{internal ? t("designs.addNote") : t("designs.send")}</button>
          </div>
          {err && <div className="err" role="alert">{err}</div>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- the stage: a face drawn on sample people
const PHOTO = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#c9d3e3"/><circle cx="50" cy="38" r="18" fill="#7f8da6"/><path d="M14 100c4-26 20-36 36-36s32 10 36 36z" fill="#7f8da6"/></svg>');

export interface Persona { id: string; name: string; title: string; ar?: boolean; label: MessageKey }
export const STAGE_PEOPLE: Persona[] = [
  { id: "short", name: "Sara Ali", title: "Designer", label: tk("designs.personaShort") },
  { id: "long", name: "Maria Fernanda de los Santos Fernandez-Rodriguez", title: "Executive Vice President, International Corporate and Institutional Business Development", label: tk("designs.personaLong") },
  { id: "ar", name: PERSONAS[0].name, title: PERSONAS[0].title, ar: true, label: tk("designs.personaArabic") },
  { id: "arlong", name: PERSONAS[5].name, title: PERSONAS[5].title, ar: true, label: tk("designs.personaArabicLong") },
];

interface StageProps {
  face: CustomFaceData;
  colour: number;
  person: { name: string; title: string; ar?: boolean };
  brandJson?: Record<string, unknown> | null;
  companyName: string;
  items?: { kind: string; value: string }[];
  photo?: boolean;
  logo?: boolean;
  /** Draw as a still thumbnail. */
  thumb?: boolean;
}

export function FaceStage({ face, colour, person, brandJson, companyName, items, photo = true, logo = true, thumb }: StageProps) {
  const data = useMemo<CardPageData>(() => {
    const base = brandJson ? toCompanyBrand(brandJson as never) : null;
    const brand = base ? { ...base, ...(logo ? {} : { logoUrl: null, symbolUrl: null }) } : null;
    return {
      name: person.name, title: person.title, company: companyName, address: "", photoUrl: photo ? PHOTO : null, coverUrl: null, saveContact: true,
      publicUrl: "https://example.com/c/sample", locale: person.ar ? "ar" : "en", brand,
      items: (items ?? [{ kind: "Mobile", value: "+974 5555 0100" }, { kind: "Email", value: "name@company.com" }, { kind: "Website", value: "company.com" }]).map((i) => ({ ...i, on: true })),
      design: { ...defaultDesign(), custom_face: face.id, colour }, customFace: face,
    };
  }, [face, colour, person, brandJson, companyName, items, photo, logo]);
  return <CardView data={data} mode={thumb ? "thumb" : "preview"} autoplay={false} />;
}
