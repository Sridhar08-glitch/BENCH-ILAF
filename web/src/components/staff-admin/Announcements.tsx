"use client";

// Announcements and e-mail: compose an in-app banner and/or an e-mail broadcast (English and Arabic both required),
// preview the audience, schedule, and see the history. Admin only to change; everyone can look.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/app/ui";
import { sa, type Announcement, type AnnouncementInput } from "@/lib/staff-admin/api";
import { fmtWhen } from "@/lib/staff-admin/format";
import { Await, NoRows, Page, Pill, ReasonDialog, RoleButton, Table, Tabs, td, toneOf, useFail } from "./ui";

const EMPTY = { title_en: "", title_ar: "", body_en: "", body_ar: "", severity: "info", audience_kind: "all", values: "", banner: true, send_email: false, email_kind: "marketing", starts_at: "", ends_at: "", email_send_at: "" };

function toIso(local: string): string | undefined {
  if (!local) return undefined;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function Compose({ plans, onSaved }: { plans: { code: string; name: string }[]; onSaved: () => void }) {
  const [f, setF] = useState(EMPTY);
  const [err, setErr] = useState("");
  const [preview, setPreview] = useState<string>("");
  const [confirm, setConfirm] = useState(false);
  const fail = useFail();
  const set = <K extends keyof typeof EMPTY>(k: K, v: (typeof EMPTY)[K]) => setF((x) => ({ ...x, [k]: v }));
  const values = f.values.split(",").map((v) => v.trim()).filter(Boolean);
  const audience = { audience_kind: f.audience_kind, audience_values: values, email_kind: f.email_kind };
  const input = (): AnnouncementInput => ({
    title_en: f.title_en, title_ar: f.title_ar, body_en: f.body_en, body_ar: f.body_ar, severity: f.severity, ...audience, banner: f.banner, send_email: f.send_email,
    starts_at: toIso(f.starts_at), ends_at: toIso(f.ends_at), email_send_at: toIso(f.email_send_at),
  });
  async function runPreview() {
    setErr("");
    try { const r = await sa.announcementPreview(audience); setPreview(`${r.label}: ${r.companies} companies, ${r.people} people would get the e-mail${r.sample.length ? ` (for example ${r.sample.join(", ")})` : ""}.`); } catch (e) { setErr(fail(e)); setPreview(""); }
  }
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
        <label className="row">Audience <select value={f.audience_kind} onChange={(e) => { set("audience_kind", e.target.value); set("values", ""); }}><option value="all">All companies</option><option value="plan">By plan</option><option value="country">By country</option><option value="companies">Chosen companies</option></select></label>
        {f.audience_kind !== "all" && (
          <label className="row">{f.audience_kind === "plan" ? "Plan codes" : f.audience_kind === "country" ? "Country codes" : "Company ids"}
            <input value={f.values} onChange={(e) => set("values", e.target.value)} placeholder={f.audience_kind === "plan" ? plans.map((p) => p.code).join(", ") : f.audience_kind === "country" ? "QA, PL" : "id, id"} style={{ minWidth: 220 }} /></label>
        )}
      </div>
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
      {preview && <p style={{ margin: 0 }}><b>Preview:</b> {preview}</p>}
      {err && <span className="err" role="alert">{err}</span>}
      <div className="row">
        <RoleButton perm="announce" className="btn ghost" onClick={() => void runPreview()}>Preview the audience</RoleButton>
        <RoleButton perm="announce" onClick={() => setConfirm(true)}>{f.send_email ? "Publish and schedule" : "Publish"}</RoleButton>
      </div>
      {confirm && (
        <ReasonDialog title="Publish this announcement" confirm="Publish" minLength={0} onClose={() => setConfirm(false)}
          text={f.send_email ? "Customers will get this e-mail. Check the texts in both languages first." : "Customers in the audience will see this banner."}
          onConfirm={async () => { try { await sa.createAnnouncement(input()); setF(EMPTY); setPreview(""); onSaved(); } catch (e) { setErr(fail(e)); throw e; } }} />
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
        {(d) => tab === "compose" ? <Compose plans={d.plans} onSaved={saved} /> : d.results.length === 0 ? <NoRows>Nothing sent yet.</NoRows> : (
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
