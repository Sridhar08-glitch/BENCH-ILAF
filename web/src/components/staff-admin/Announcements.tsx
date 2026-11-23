"use client";

// Announcements and e-mail: compose an in-app banner and/or an e-mail broadcast (English and Arabic both required),
// pick the audience with chips (plan, country, companies) and watch the recipient count follow it, preview the banner and the
// e-mail, type SEND to confirm, and see the history. Admin only to change; everyone can look.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/app/ui";
import { sa, type Announcement, type AnnouncementInput, type AnnouncementLists } from "@/lib/staff-admin/api";
import { fmtWhen } from "@/lib/staff-admin/format";
import { audienceReady, audienceSentence, COMPANIES_STORAGE_KEY, incomingCompanyIds, SEND_WORD } from "@/lib/staff-admin/frame";
import { Await, NoRows, Page, Pill, ReasonDialog, RoleButton, Table, Tabs, td, toneOf, useCan, useDebounced, useFail } from "./ui";
import { CompanyPicker, countryOptions, ListPicker, type PickChip } from "./pickers";

const EMPTY = { title_en: "", title_ar: "", body_en: "", body_ar: "", severity: "info", audience_kind: "all", banner: true, send_email: false, email_kind: "marketing", starts_at: "", ends_at: "", email_send_at: "" };

function toIso(local: string): string | undefined {
  if (!local) return undefined;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** The company ids this screen was opened with (the Companies list passes them in the address or in the browser storage). */
function readIncoming(): string[] {
  try {
    const stored = window.sessionStorage.getItem(COMPANIES_STORAGE_KEY);
    window.sessionStorage.removeItem(COMPANIES_STORAGE_KEY);
    return incomingCompanyIds(window.location.search, stored);
  } catch {
    return incomingCompanyIds(window.location.search, null);
  }
}

function EmailPreview({ f }: { f: typeof EMPTY }) {
  const canPreview = useCan("announce");
  const [lang, setLang] = useState<"en" | "ar">("en");
  const title = lang === "ar" ? f.title_ar : f.title_en;
  const body = lang === "ar" ? f.body_ar : f.body_en;
  const key = useDebounced(JSON.stringify([lang, title, body, f.email_kind]), 500);
  const q = useQuery({
    queryKey: ["staff-email-preview", key],
    queryFn: () => sa.announcementEmailPreview({ title, body, lang, email_kind: f.email_kind }),
    enabled: canPreview,
    placeholderData: (p) => p,
  });
  return (
    <div style={{ display: "grid", gap: 8 }} data-testid="email-preview">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="hint">E-mail as customers receive it</span>
        <span className="row" role="group" aria-label="Preview language">
          <button type="button" className={`btn sm ${lang === "en" ? "" : "ghost"}`} aria-pressed={lang === "en"} onClick={() => setLang("en")}>English</button>
          <button type="button" className={`btn sm ${lang === "ar" ? "" : "ghost"}`} aria-pressed={lang === "ar"} onClick={() => setLang("ar")}>Arabic</button>
        </span>
      </div>
      {q.error ? <span className="err" role="alert">The preview could not be made.</span> : (
        <>
          {q.data && <b dir="auto">Subject: {q.data.subject}</b>}
          <iframe title="E-mail preview" sandbox="" srcDoc={q.data?.html ?? ""} style={{ inlineSize: "100%", blockSize: 420, border: "1px solid var(--line)", borderRadius: "var(--r-sm)", background: "#fff" }} />
        </>
      )}
    </div>
  );
}

function Compose({ lists, onSaved }: { lists: AnnouncementLists; onSaved: () => void }) {
  const [f, setF] = useState(EMPTY);
  const [picked, setPicked] = useState<string[]>([]);
  const [companies, setCompanies] = useState<PickChip[]>([]);
  const [err, setErr] = useState("");
  const [confirm, setConfirm] = useState(false);
  const fail = useFail();
  const canAnnounce = useCan("announce");
  const set = <K extends keyof typeof EMPTY>(k: K, v: (typeof EMPTY)[K]) => setF((x) => ({ ...x, [k]: v }));

  // A selection made on the Companies list: fill the audience and look the names up.
  useEffect(() => {
    const ids = readIncoming();
    if (ids.length === 0) return;
    setF((x) => ({ ...x, audience_kind: "companies" }));
    setCompanies(ids.map((id) => ({ value: id, label: id.slice(0, 8) })));
    for (const id of ids) {
      sa.company(id)
        .then((c) => setCompanies((cur) => cur.map((x) => (x.value === id ? { value: id, label: c.name, sub: c.owner?.email } : x))))
        .catch(() => setCompanies((cur) => cur.filter((x) => x.value !== id)));
    }
  }, []);

  const values = f.audience_kind === "companies" ? companies.map((c) => c.value) : f.audience_kind === "all" ? [] : picked;
  const ready = audienceReady(f.audience_kind, values);
  const audience = { audience_kind: f.audience_kind, audience_values: values, email_kind: f.email_kind };
  const input = (): AnnouncementInput => ({
    title_en: f.title_en, title_ar: f.title_ar, body_en: f.body_en, body_ar: f.body_ar, severity: f.severity, ...audience, banner: f.banner, send_email: f.send_email,
    starts_at: toIso(f.starts_at), ends_at: toIso(f.ends_at), email_send_at: toIso(f.email_send_at),
  });

  const audienceKey = useDebounced(JSON.stringify([f.audience_kind, values, f.email_kind]), 400);
  const count = useQuery({
    queryKey: ["staff-audience", audienceKey],
    queryFn: () => { const [kind, vals, emailKind] = JSON.parse(audienceKey) as [string, string[], string]; return sa.announcementAudience(kind, vals, emailKind); },
    enabled: ready && canAnnounce,
    placeholderData: (p) => p,
  });
  const counted = ready ? count.data : undefined;
  const sentence = counted ? audienceSentence(counted, { banner: f.banner, email: f.send_email }) : "";

  return (
    <div className="panel" style={{ padding: 16, display: "grid", gap: 12 }}>
      <p className="hint" style={{ margin: 0 }}>Write both languages. Customers see the text in their own language.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
        <div style={{ display: "grid", gap: 8 }}>
          <label style={{ display: "grid", gap: 4 }}>Title (English)<input value={f.title_en} maxLength={120} onChange={(e) => set("title_en", e.target.value)} /></label>
          <label style={{ display: "grid", gap: 4 }}>Text (English)<textarea rows={3} maxLength={600} value={f.body_en} onChange={(e) => set("body_en", e.target.value)} /></label>
        </div>
        <div style={{ display: "grid", gap: 8 }} dir="rtl" lang="ar">
          <label style={{ display: "grid", gap: 4 }}>العنوان (بالعربية)<input value={f.title_ar} maxLength={120} onChange={(e) => set("title_ar", e.target.value)} /></label>
          <label style={{ display: "grid", gap: 4 }}>النص (بالعربية)<textarea rows={3} maxLength={600} value={f.body_ar} onChange={(e) => set("body_ar", e.target.value)} /></label>
        </div>
      </div>
      <div className="row">
        <label className="row">Severity <select value={f.severity} onChange={(e) => set("severity", e.target.value)}><option value="info">Info</option><option value="warning">Warning</option><option value="critical">Critical</option></select></label>
        <label className="row">Audience <select value={f.audience_kind} onChange={(e) => { set("audience_kind", e.target.value); setPicked([]); }}><option value="all">All companies</option><option value="plan">By plan</option><option value="country">By country</option><option value="companies">Chosen companies</option></select></label>
      </div>
      {f.audience_kind === "plan" && <ListPicker label="Plans" all={lists.plans.map((p) => ({ value: p.code, label: p.name }))} selected={picked} onChange={setPicked} placeholder="Choose one or more plans" testId="plan-picker" />}
      {f.audience_kind === "country" && (
        lists.countries.length === 0
          ? <span className="hint">No company has chosen a country yet.</span>
          : <ListPicker label="Countries" all={countryOptions(lists.countries)} selected={picked} onChange={setPicked} placeholder="Choose one or more countries" testId="country-picker" />
      )}
      {f.audience_kind === "companies" && <CompanyPicker selected={companies} onChange={setCompanies} testId="company-picker" />}
      <p style={{ margin: 0 }} role="status" data-testid="audience-count">
        {!canAnnounce ? <span className="hint">Only an admin can publish announcements.</span> : !ready ? <span className="hint">Choose who this is for to see how many will get it.</span> : counted ? <><b>{sentence}</b>{count.isFetching && <span className="hint"> Updating...</span>}</> : count.error ? <span className="err">The count could not be made.</span> : <span className="hint">Counting...</span>}
      </p>
      <div className="row">
        <label className="row"><input type="checkbox" checked={f.banner} onChange={(e) => set("banner", e.target.checked)} /> Banner in the app</label>
        <label className="row"><input type="checkbox" checked={f.send_email} onChange={(e) => set("send_email", e.target.checked)} /> Send an e-mail</label>
        {f.send_email && <label className="row">E-mail is a <select value={f.email_kind} onChange={(e) => set("email_kind", e.target.value)}><option value="marketing">Product update (only people who agreed)</option><option value="transactional">Service notice (owners and admins)</option></select></label>}
      </div>
      <div className="row">
        <label className="row">Shows from <input type="datetime-local" value={f.starts_at} onChange={(e) => set("starts_at", e.target.value)} /></label>
        <label className="row">until <input type="datetime-local" value={f.ends_at} onChange={(e) => set("ends_at", e.target.value)} /></label>
        {f.send_email && <label className="row">E-mail at <input type="datetime-local" value={f.email_send_at} onChange={(e) => set("email_send_at", e.target.value)} /></label>}
      </div>
      {f.banner && (
        <div className={`notice ${f.severity === "critical" ? "bad" : f.severity === "warning" ? "warn" : ""}`} aria-label="Banner preview"><div className="grow"><b>{f.title_en || "Title"}</b>{f.body_en || "Text"}</div></div>
      )}
      {f.send_email && <EmailPreview f={f} />}
      {err && <span className="err" role="alert">{err}</span>}
      <div className="row">
        <RoleButton perm="announce" disabled={!ready} title={ready ? undefined : "Choose who this is for first."} onClick={() => setConfirm(true)}>{f.send_email ? "Publish and schedule" : "Publish"}</RoleButton>
      </div>
      {confirm && (
        <ReasonDialog title="Publish this announcement" confirm={f.send_email ? "Send" : "Publish"} minLength={0} typed={SEND_WORD} onClose={() => setConfirm(false)}
          text={<>{sentence || "Customers in the audience will see this."} {f.send_email ? "Customers will get this e-mail and it cannot be recalled. Check the texts in both languages first." : "It stays up until it ends or you cancel it."}</>}
          onConfirm={async () => { try { await sa.createAnnouncement(input()); setF(EMPTY); setPicked([]); setCompanies([]); onSaved(); } catch (e) { setErr(fail(e)); throw e; } }} />
      )}
    </div>
  );
}

export default function Announcements() {
  const [tab, setTab] = useState<"compose" | "history">("compose");
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["staff-announcements"], queryFn: sa.announcements });
  const saved = () => { toast("Announcement published"); void qc.invalidateQueries({ queryKey: ["staff-announcements"] }); setTab("history"); };
  return (
    <Page title="Announcements and e-mail" sub="Tell customers something: a banner in the app, an e-mail, or both.">
      <Tabs tabs={[{ key: "compose", label: "Compose" }, { key: "history", label: "History", count: q.data?.results.length }]} value={tab} onChange={setTab} />
      <Await q={q}>
        {(d) => tab === "compose" ? <Compose lists={d} onSaved={saved} /> : d.results.length === 0 ? <NoRows>Nothing sent yet.</NoRows> : (
          <Table head={["Title", "Audience", "Banner", "E-mail", "Created", ""]}>
            {d.results.map((a: Announcement) => (
              <tr key={a.id}>
                <td style={td}><b>{a.title_en}</b><div className="hint" dir="rtl" lang="ar">{a.title_ar}</div></td>
                <td style={td}>{a.audience}</td>
                <td style={td}>{a.banner ? (a.cancelled ? <Pill>Cancelled</Pill> : a.live ? <Pill tone="ok">Showing</Pill> : <Pill>Not showing</Pill>) : "-"}<div className="hint">{fmtWhen(a.starts_at)}{a.ends_at ? ` to ${fmtWhen(a.ends_at)}` : ""}</div></td>
                <td style={td}>{a.send_email ? <><Pill tone={toneOf(a.email_status === "sent" ? "sent" : "scheduled")}>{a.email_status}</Pill> {a.email_sent_count} sent<div className="hint">{a.email_kind === "marketing" ? "Product update" : "Service notice"}{a.email_send_at ? `, at ${fmtWhen(a.email_send_at)}` : ""}</div></> : "-"}</td>
                <td style={td}>{fmtWhen(a.created_at)}</td>
                <td style={td}>{!a.cancelled && <RoleButton perm="announce" className="btn sm ghost" onClick={() => void sa.cancelAnnouncement(a.id).then(() => qc.invalidateQueries({ queryKey: ["staff-announcements"] }))}>Cancel</RoleButton>}</td>
              </tr>
            ))}
          </Table>
        )}
      </Await>
    </Page>
  );
}
