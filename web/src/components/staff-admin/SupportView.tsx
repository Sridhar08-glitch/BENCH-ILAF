"use client";

// Support view: a read-only mirror of a company's account. Start (reason required, 30 minutes), a banner on every page,
// mirror pages for the team, cards, leads, brand and activity, an end button and the log of what was opened.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/app/ui";
import { Dialog } from "@/components/ops/shared";
import { ApiError } from "@/lib/api";
import { sa, type ActivityRow, type BrandInfo, type CardRow, type LeadRow, type Member, type SupportSession } from "@/lib/staff-admin/api";
import { cardStatusWord } from "@/lib/staff-admin/card-data";
import { fmtClock, fmtDay, fmtNumber, fmtWhen } from "@/lib/staff-admin/format";
import { can } from "@/lib/staff-admin/roles";
import { ActivityList, BrandView } from "./CompanyDetail";
import { StaffCardThumb } from "./StaffCardThumb";
import { Await, NoRows, Page, Pill, Table, Tabs, td, toneOf, useDebounced, useFail, useRole } from "./ui";

const MIN_REASON = 8;

export function StartSupportDialog({ company, onClose }: { company: { id: string; name: string }; onClose: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const fail = useFail();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function start() {
    setBusy(true);
    setErr("");
    try {
      const s = await sa.supportStart(company.id, reason.trim());
      await qc.invalidateQueries({ queryKey: ["support-session"] });
      onClose();
      router.push(`/staff/support-view/${s.id}`);
    } catch (e) { setErr(fail(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog
      title={`Open a support view of ${company.name}`} onClose={onClose}
      footer={<><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button type="button" className="btn" disabled={reason.trim().length < MIN_REASON || busy} onClick={() => void start()}>{busy ? "Starting..." : "Start support view"}</button></>}
    >
      <div style={{ display: "grid", gap: 10 }}>
        <ul style={{ margin: 0, paddingInlineStart: 18 }}>
          <li>You see the company exactly as it is, read only. You cannot change anything.</li>
          <li>It ends by itself after 30 minutes. You can have one open at a time.</li>
          <li><b>The company sees it in its own Activity log</b>, with your reason. Staff see it in the audit log.</li>
        </ul>
        <label style={{ display: "grid", gap: 4 }}>Reason (the company can read it)
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={300} placeholder="For example: the owner asked us to check why a card does not show" />
        </label>
        {err && <span className="err" role="alert">{err}</span>}
      </div>
    </Dialog>
  );
}

/** The open session of this staff person, kept fresh. */
export function useSupportSession() {
  const role = useRole();
  return useQuery({
    queryKey: ["support-session"], queryFn: sa.supportCurrent, enabled: can(role, "support"), refetchInterval: 30_000, staleTime: 10_000, retry: false,
  });
}

/** The strip shown on every staff page while a support view is open. */
export function SupportBanner() {
  const q = useSupportSession();
  const qc = useQueryClient();
  const toast = useToast();
  const s = q.data?.session ?? null;
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!s) return;
    const end = Date.now() + s.seconds_left * 1000;
    const tick = () => {
      const n = Math.max(0, Math.round((end - Date.now()) / 1000));
      setLeft(n);
      if (n === 0) void qc.invalidateQueries({ queryKey: ["support-session"] });
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [s, qc]);
  if (!s) return null;
  async function end() {
    if (!s) return;
    try { await sa.supportEnd(s.id); toast("Support view ended and logged"); } catch { /* already ended */ }
    await qc.invalidateQueries({ queryKey: ["support-session"] });
  }
  return (
    <div role="status" style={{ background: "var(--orange)", color: "var(--ink)", padding: "8px 18px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", fontSize: 13, fontWeight: 600 }}>
      <span>Support view · read-only · logged</span>
      <span>{s.company_name}</span>
      <span aria-label="Time left">{fmtClock(left)} left</span>
      <span style={{ flex: 1 }} />
      <Link href={`/staff/support-view/${s.id}`} className="btn ghost sm">Return to the view</Link>
      <button type="button" className="btn sm" onClick={() => void end()}>End session</button>
    </div>
  );
}

// ---------------------------------------------------------------- the page that starts one
export default function SupportViewHome() {
  const router = useRouter();
  const session = useSupportSession();
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<{ id: string; name: string } | null>(null);
  const term = useDebounced(q.trim());
  const found = useQuery({ queryKey: ["staff-companies", term, "", "", "name", 1, "pick"], queryFn: () => sa.companies({ q: term }), enabled: term.length >= 2 });
  const history = useQuery({ queryKey: ["support-history"], queryFn: sa.supportHistory });
  const current = session.data?.session ?? null;
  return (
    <Page title="Support view" sub="Look at a company's account the way its owner sees it. Read only, 30 minutes, always logged.">
      {current && (
        <div className="notice"><div className="grow"><b>A support view is open: {current.company_name}</b>It ends at {fmtWhen(current.expires_at)}.
          <div style={{ marginBlockStart: 8 }}><button type="button" className="btn sm" onClick={() => router.push(`/staff/support-view/${current.id}`)}>Return to the view</button></div></div></div>
      )}
      <section className="panel" style={{ padding: 14, display: "grid", gap: 8 }}>
        <h2 style={{ fontSize: 16 }}>Start a support view</h2>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find the company by name or owner e-mail" aria-label="Find a company" style={{ maxWidth: 420 }} />
        {term.length >= 2 && found.data && (found.data.results.length === 0 ? <span className="hint">No company matches.</span> : found.data.results.slice(0, 8).map((c) => (
          <div key={c.id} className="row" style={{ justifyContent: "space-between" }}><span><b>{c.name}</b> <span className="hint">{c.owner_email}</span></span><button type="button" className="btn sm" onClick={() => setPick({ id: c.id, name: c.name })}>Open support view</button></div>
        )))}
      </section>
      <section style={{ display: "grid", gap: 8 }}>
        <h2 style={{ fontSize: 16 }}>Recent support views</h2>
        <Await q={history}>
          {(rows) => rows.length === 0 ? <NoRows>None yet.</NoRows> : (
            <Table head={["Company", "Staff", "Reason", "Started", "Ended", "Pages opened"]}>
              {rows.map((s) => (
                <tr key={s.id}><td style={td}>{s.company_name}</td><td style={td}>{s.staff_email}</td><td style={td}>{s.reason}</td><td style={td}>{fmtWhen(s.started_at)}</td>
                  <td style={td}>{s.active ? <Pill tone="warn">Open</Pill> : <>{fmtWhen(s.ended_at)} <span className="hint">({s.ended_how})</span></>}</td>
                  <td style={td}>{s.pages.map((p) => p.page).join(", ") || "-"}</td></tr>
              ))}
            </Table>
          )}
        </Await>
      </section>
      {pick && <StartSupportDialog company={pick} onClose={() => setPick(null)} />}
    </Page>
  );
}

// ---------------------------------------------------------------- the mirror
const MIRROR_TABS = [
  { key: "overview", label: "Overview" }, { key: "team", label: "Team" }, { key: "cards", label: "Cards" }, { key: "leads", label: "Leads" },
  { key: "brand", label: "Brand" }, { key: "activity", label: "Activity" }, { key: "log", label: "What was viewed" },
] as const;
type MirrorKey = (typeof MIRROR_TABS)[number]["key"];

export function SupportMirror({ sid }: { sid: string }) {
  const [tab, setTab] = useState<MirrorKey>("overview");
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["support-mirror", sid, tab], queryFn: () => sa.supportPage<unknown>(sid, tab), retry: false, refetchOnWindowFocus: false });
  const ended = q.error instanceof ApiError && (q.error.code === "support_view_ended" || q.error.status === 404);
  async function end() {
    try { await sa.supportEnd(sid); toast("Support view ended and logged"); } catch { /* already over */ }
    await qc.invalidateQueries({ queryKey: ["support-session"] });
    router.push("/staff/support-view");
  }
  if (ended) {
    return (
      <Page title="Support view ended" sub="This session is over, so nothing more can be shown.">
        <Link href="/staff/support-view" className="btn">Start a new support view</Link>
      </Page>
    );
  }
  const s: SupportSession | undefined = (q.data as { session?: SupportSession } | undefined)?.session;
  return (
    <Page title={s ? `Support view: ${s.company_name}` : "Support view"} sub="Read only. Everything you open here is logged and the company can see this session in its Activity log."
      actions={<button type="button" className="btn" onClick={() => void end()}>End session</button>}>
      <Tabs tabs={MIRROR_TABS.map((t) => ({ key: t.key, label: t.label }))} value={tab} onChange={setTab} />
      <Await q={q}>{(r) => <MirrorPage tab={tab} data={(r as { data: unknown }).data} />}</Await>
    </Page>
  );
}

function MirrorPage({ tab, data }: { tab: MirrorKey; data: unknown }) {
  if (tab === "team") {
    const rows = data as Member[];
    return (
      <Table head={["Person", "Role", "Status", "Department", "Joined", "Last signed in"]}>
        {rows.map((m) => <tr key={m.id}><td style={td}><b>{m.full_name || m.email}</b><div className="hint">{m.email}{m.title ? ` - ${m.title}` : ""}</div></td><td style={td}>{m.role}</td><td style={td}><Pill tone={toneOf(m.status)}>{m.status}</Pill></td><td style={td}>{m.department || "-"}</td><td style={td}>{fmtDay(m.joined_at)}</td><td style={td}>{fmtDay(m.last_sign_in)}</td></tr>)}
      </Table>
    );
  }
  if (tab === "cards") {
    const rows = data as CardRow[];
    return rows.length === 0 ? <NoRows>No cards.</NoRows> : (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
        {rows.map((c) => (
          <div key={c.id} className="panel" style={{ padding: 10, display: "grid", gap: 6 }}>
            <StaffCardThumb card={c} width={140} />
            <b>{c.name || "(no name)"}</b><span className="hint">{c.title}</span><span><Pill tone={toneOf(c.status)}>{cardStatusWord(c)}</Pill></span>
            <span className="hint">{c.items.filter((i) => i.on).length} buttons, {fmtNumber(c.stats.views)} views</span>
          </div>
        ))}
      </div>
    );
  }
  if (tab === "leads") {
    const rows = data as LeadRow[];
    return rows.length === 0 ? <NoRows>No leads.</NoRows> : (
      <Table head={["Name", "E-mail", "Phone", "Note", "Card", "Status", "Source", "When"]}>
        {rows.map((l) => (
          <tr key={l.id}><td style={td}><b>{l.name}</b></td><td style={td}>{l.email}</td><td style={td}>{l.phone}</td><td style={td}>{l.note}{l.notes?.map((n, i) => <div key={i} className="hint">{n.author}: {n.body}</div>)}</td><td style={td}>{l.card_name}</td><td style={td}><Pill tone={toneOf(l.status)}>{l.status}</Pill></td><td style={td}>{l.source}</td><td style={td}>{fmtDay(l.created_at)}</td></tr>
        ))}
      </Table>
    );
  }
  if (tab === "brand") return <BrandView b={data as BrandInfo} />;
  if (tab === "activity") return <ActivityList rows={(data as { results: ActivityRow[] }).results} />;
  if (tab === "log") {
    const pages = (data as { pages: { t: string; page: string }[] }).pages;
    return <div className="panel" style={{ padding: 12, display: "grid", gap: 4 }}>{pages.map((p, i) => <div key={i} className="row" style={{ justifyContent: "space-between" }}><b>{p.page}</b><span className="hint">{fmtWhen(p.t)}</span></div>)}</div>;
  }
  const o = data as { name: string; plan: string | null; status: string; counts: { members: number; cards_published: number; leads: number; views_30d: number } };
  return (
    <div className="panel" style={{ padding: 14, display: "grid", gap: 6 }}>
      <h2 style={{ fontSize: 18 }}>{o.name}</h2>
      <span>{o.plan ?? "No plan"} - {o.status}</span>
      <span className="hint">{o.counts.members} people, {o.counts.cards_published} live cards, {o.counts.leads} leads, {o.counts.views_30d} views in 30 days</span>
    </div>
  );
}
