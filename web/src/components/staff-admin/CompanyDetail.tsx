"use client";

// One company: Overview, Team, Cards, Leads, Brand, Activity, Notes and the Danger zone (admin only).
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/app/ui";
import { sa, type ActivityRow, type BrandInfo, type CardRow, type CompanyDetail as Detail, type LeadRow, type Member, type Note } from "@/lib/staff-admin/api";
import { countryName } from "@/lib/countries";
import { fmtDay, fmtNumber, fmtWhen, humanAction } from "@/lib/staff-admin/format";
import { StaffCardThumb } from "./StaffCardThumb";
import { StartSupportDialog } from "./SupportView";
import { STATUS_WORDS } from "./Companies";
import { Await, Kpi, NoRows, Page, Pill, ReasonDialog, RoleButton, Table, Tabs, td, toneOf, useFail } from "./ui";
import { cardStatusWord } from "@/lib/staff-admin/card-data";
import { brandSwatches, cardStateWord, fontName, seatsInfo, viewsPoints } from "@/lib/staff-admin/company-page";
import { BarChart } from "./charts";
import { CardDrawer } from "./People";

const TABS = ["Overview", "Team", "Cards", "Leads", "Brand", "Activity", "Notes", "Danger zone"] as const;
type Tab = (typeof TABS)[number];

export default function CompanyDetail({ id }: { id: string }) {
  const [tab, setTab] = useState<Tab>("Overview");
  const [support, setSupport] = useState(false);
  const q = useQuery({ queryKey: ["staff-company", id], queryFn: () => sa.company(id) });
  return (
    <Await q={q}>
      {(c) => (
        <Page
          title={c.name}
          sub={`${c.owner ? `Owner ${c.owner.full_name || c.owner.email} (${c.owner.email})` : "No owner"} - joined ${fmtDay(c.created_at)}`}
          actions={<><Link href="/staff/companies" className="btn ghost sm">All companies</Link><RoleButton perm="support" onClick={() => setSupport(true)}>Open support view</RoleButton></>}
        >
          <div className="row"><Pill tone={toneOf(c.status)}>{STATUS_WORDS[c.status] ?? c.status}</Pill>{c.plan && <Pill tone="accent">{c.plan}</Pill>}{c.country && <Pill>{c.country_guessed ? `Probably ${countryName(c.country, "en")} (guessed from visitors)` : `Country: ${countryName(c.country, "en")}`}</Pill>}</div>
          {c.suspended && <div className="notice bad" role="status"><div className="grow"><b>Suspended {fmtWhen(c.suspended_at)}</b>{c.suspended_reason}</div></div>}
          <Tabs tabs={TABS.map((t) => ({ key: t, label: t }))} value={tab} onChange={setTab} />
          {tab === "Overview" && <OverviewTab c={c} />}
          {tab === "Team" && <TeamTab id={id} />}
          {tab === "Cards" && <CardsTab id={id} />}
          {tab === "Leads" && <LeadsTab id={id} />}
          {tab === "Brand" && <BrandTab id={id} />}
          {tab === "Activity" && <ActivityTab id={id} />}
          {tab === "Notes" && <NotesTab id={id} />}
          {tab === "Danger zone" && <DangerTab c={c} />}
          {support && <StartSupportDialog company={{ id: c.id, name: c.name }} onClose={() => setSupport(false)} />}
        </Page>
      )}
    </Await>
  );
}

function SeatsBar({ used, total }: { used: number; total: number }) {
  const seats = seatsInfo(used, total);
  const fill = seats.state === "full" ? "var(--danger)" : seats.state === "near" ? "var(--warn)" : "var(--accent)";
  return (
    <section className="panel" aria-label="Seats" style={{ padding: 14, display: "grid", gap: 8, alignContent: "start" }}>
      <h3 style={{ margin: 0, fontSize: 15 }}>Seats</h3>
      <b style={{ fontSize: 22 }}>{used} of {total} used{seats.state !== "none" ? ` (${seats.percent}%)` : ""}</b>
      <div role="progressbar" aria-label="Seats used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={seats.percent} style={{ height: 10, borderRadius: 999, background: "var(--surface-2)", overflow: "hidden" }}>
        <div style={{ width: `${seats.percent}%`, height: "100%", background: fill, borderRadius: 999 }} />
      </div>
      {seats.state === "near" || seats.state === "full"
        ? <div className={`notice ${seats.state === "full" ? "bad" : "warn"}`} role="status"><div className="grow">{seats.note}</div></div>
        : <span className="hint">{seats.note}</span>}
    </section>
  );
}

function AccountPanel({ c }: { c: Detail }) {
  const row = (label: string, value: ReactNode) => <><dt className="hint">{label}</dt><dd style={{ margin: 0, overflowWrap: "anywhere" }}>{value}</dd></>;
  return (
    <section className="panel" aria-label="Account" style={{ padding: 14, display: "grid", gap: 8, alignContent: "start" }}>
      <h3 style={{ margin: 0, fontSize: 15 }}>Account</h3>
      <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "6px 16px", margin: 0 }}>
        {row("Plan", c.plan ?? "No plan")}
        {row("Status", STATUS_WORDS[c.status] ?? c.status)}
        {row("Owner", c.owner?.full_name || "-")}
        {row("Owner e-mail", c.owner?.email ?? "-")}
        {row("Country", c.country ? countryName(c.country, "en") : "-")}
        {row("Public address", c.public_address ? <a href={c.public_address} target="_blank" rel="noopener noreferrer">{c.public_address}</a> : "None")}
      </dl>
    </section>
  );
}

function OverviewTab({ c }: { c: Detail }) {
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        <Kpi label="People" value={`${c.seats_used} of ${c.seats_total}`} hint="seats used" />
        <Kpi label="Live cards" value={fmtNumber(c.counts.cards_published)} hint={`${c.counts.cards_draft} drafts, ${c.counts.cards_suspended} suspended`} />
        <Kpi label="Leads" value={fmtNumber(c.counts.leads)} />
        <Kpi label="Views, last 30 days" value={fmtNumber(c.counts.views_30d)} />
        <Kpi label="Open card reports" value={fmtNumber(c.counts.open_reports)} tone={c.counts.open_reports ? "bad" : undefined} />
        <Kpi label="Open design requests" value={fmtNumber(c.open_design_requests)} />
        <Kpi label="Plan runs until" value={c.plan_ends_at ? fmtDay(c.plan_ends_at) : "-"} hint={c.plan ?? "No plan"} />
        <Kpi label="Owner last signed in" value={c.owner?.last_sign_in ? fmtDay(c.owner.last_sign_in) : "-"} />
        <Kpi label="Support views" value={fmtNumber(c.counts.support_views)} hint="all time" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
        <SeatsBar used={c.seats_used} total={c.seats_total} />
        <AccountPanel c={c} />
      </div>
      <section className="panel" aria-label="Views, last 14 days" style={{ padding: 14, display: "grid", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>Views, last 14 days</h3>
        <BarChart data={viewsPoints(c.views_14d)} label="Card views per day, last 14 days" height={200} format={(v) => fmtNumber(Math.round(v))} />
      </section>
    </div>
  );
}

function TeamTab({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["staff-company-team", id], queryFn: () => sa.companyTab<Member[]>(id, "team") });
  return (
    <Await q={q}>
      {(rows) => rows.length === 0 ? <NoRows>No people yet.</NoRows> : (
        <Table head={["Person", "Title", "Role", "Status", "Card", "Department", "Joined", "Last signed in"]}>
          {rows.map((m) => (
            <tr key={m.id}>
              <td style={td}>{m.user_id ? <Link href={`/staff/people?user=${m.user_id}`}><b>{m.full_name || m.email}</b></Link> : <b>{m.full_name || m.email}</b>}<div className="hint">{m.email}</div></td>
              <td style={td}>{m.title || "-"}</td>
              <td style={td}>{m.role}</td><td style={td}><Pill tone={toneOf(m.status)}>{m.status}</Pill></td>
              <td style={td}><Pill tone={m.card_status === "published" ? "ok" : m.card_status === "suspended" ? "bad" : ""}>{cardStateWord(m.card_status)}</Pill>{m.cards > 1 && <span className="hint"> {m.cards} cards</span>}</td>
              <td style={td}>{m.department || "-"}</td>
              <td style={td}>{fmtDay(m.joined_at)}</td><td style={td}>{fmtDay(m.last_sign_in)}</td>
            </tr>
          ))}
        </Table>
      )}
    </Await>
  );
}

function CardsTab({ id }: { id: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["staff-company-cards", id], queryFn: () => sa.companyTab<CardRow[]>(id, "cards") });
  return (
    <Await q={q}>
      {(rows) => rows.length === 0 ? <NoRows>No cards yet.</NoRows> : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
            {rows.map((c) => (
              <button key={c.id} type="button" className="panel" onClick={() => setOpen(c.id)} style={{ padding: 10, display: "grid", gap: 6, textAlign: "start", cursor: "pointer" }}>
                <StaffCardThumb card={c} width={130} />
                <b>{c.name || "(no name)"}</b><span className="hint">{c.title}</span>
                <span className="row"><Pill tone={toneOf(c.status)}>{cardStatusWord(c)}</Pill></span>
                <span className="hint">{fmtNumber(c.stats.views)} views, {fmtNumber(c.stats.leads)} leads</span>
              </button>
            ))}
          </div>
          {open && <CardDrawer id={open} onClose={() => setOpen(null)} />}
        </>
      )}
    </Await>
  );
}

function LeadsTab({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["staff-company-leads", id], queryFn: () => sa.companyTab<{ total: number; by_status: Record<string, number>; latest: LeadRow[] }>(id, "leads") });
  return (
    <Await q={q}>
      {(d) => (
        <>
          <div className="row">{Object.entries(d.by_status).map(([s, n]) => <Pill key={s} tone={toneOf(s)}>{s}: {n}</Pill>)}<span className="hint">{d.total} in total. E-mail addresses are hidden here; open a support view to see leads in full.</span></div>
          {d.latest.length === 0 ? <NoRows>No leads yet.</NoRows> : (
            <Table head={["Name", "E-mail", "Card", "Status", "Source", "When"]}>
              {d.latest.map((l) => <tr key={l.id}><td style={td}><b>{l.name}</b></td><td style={td}>{l.email}</td><td style={td}>{l.card_name}</td><td style={td}><Pill tone={toneOf(l.status)}>{l.status}</Pill></td><td style={td}>{l.source}</td><td style={td}>{fmtDay(l.created_at)}</td></tr>)}
            </Table>
          )}
        </>
      )}
    </Await>
  );
}

export function BrandView({ b }: { b: BrandInfo }) {
  return (
    <div className="panel" style={{ padding: 14, display: "grid", gap: 10 }}>
      <div className="row">
        {b.logo_url ? <img src={b.logo_url} alt="Company logo" style={{ height: 48, maxWidth: 160, objectFit: "contain" }} /> : <Pill>No logo</Pill>}
        {b.symbol_url && <img src={b.symbol_url} alt="Company symbol" style={{ height: 48, objectFit: "contain" }} />}
      </div>
      <div className="row" aria-label="Brand colours">
        {brandSwatches(b.colours).map((s) => (
          <span key={s.name} className="row" style={{ gap: 8 }}>
            <span aria-hidden style={{ width: 28, height: 28, borderRadius: 8, border: "1px solid var(--line)", background: s.hex, display: "inline-block" }} />
            <span><b>{s.name}</b><span className="hint" style={{ display: "block" }}>{s.hex}</span></span>
          </span>
        ))}
        {brandSwatches(b.colours).length === 0 && <span className="hint">No brand colours chosen.</span>}
      </div>
      <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "6px 16px", margin: 0 }}>
        <dt className="hint">Company name</dt><dd style={{ margin: 0 }}>{b.company_name}</dd>
        <dt className="hint">Website</dt><dd style={{ margin: 0 }}>{b.website || "-"}</dd>
        <dt className="hint">Card font</dt><dd style={{ margin: 0 }}>{fontName(b.font)}</dd>
        <dt className="hint">Design locked</dt><dd style={{ margin: 0 }}>{b.lock_design ? "Yes" : "No"}</dd>
        <dt className="hint">Footer shown</dt><dd style={{ margin: 0 }}>{b.show_footer ? "Yes" : "No"}</dd>
        <dt className="hint">Google sign-in required</dt><dd style={{ margin: 0 }}>{b.require_google_signin ? "Yes" : "No"}</dd>
        <dt className="hint">Allowed e-mail domains</dt><dd style={{ margin: 0 }}>{b.allowed_email_domains.join(", ") || "Any"}</dd>
        <dt className="hint">Directory</dt><dd style={{ margin: 0 }}>{b.directory_enabled ? `On (${b.directory_slug})` : "Off"}</dd>
        <dt className="hint">Custom domain</dt><dd style={{ margin: 0 }}>{b.custom_domain || "-"}</dd>
      </dl>
    </div>
  );
}

function BrandTab({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["staff-company-brand", id], queryFn: () => sa.companyTab<BrandInfo>(id, "brand") });
  return <Await q={q}>{(b) => <BrandView b={b} />}</Await>;
}

export function ActivityList({ rows }: { rows: ActivityRow[] }) {
  if (rows.length === 0) return <NoRows>Nothing recorded yet.</NoRows>;
  return (
    <div className="panel" style={{ padding: 10, display: "grid", gap: 4 }}>
      {rows.map((e) => (
        <div key={e.id} className="row" style={{ justifyContent: "space-between", borderTop: "1px solid var(--line)", paddingTop: 6 }}>
          <span><b>{e.actor_name || e.actor_email || "System"}</b> {e.label || humanAction(e.action)}{e.target_label ? `: ${e.target_label}` : ""}</span>
          <span className="hint">{fmtWhen(e.created_at)}</span>
        </div>
      ))}
    </div>
  );
}

function ActivityTab({ id }: { id: string }) {
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ["staff-company-activity", id, page], queryFn: () => sa.companyTab<{ count: number; results: ActivityRow[] }>(id, "activity", { page: String(page) }), placeholderData: (p) => p });
  return (
    <Await q={q}>
      {(d) => (
        <>
          <ActivityList rows={d.results} />
          <div className="row"><button type="button" className="btn ghost sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Newer</button><button type="button" className="btn ghost sm" disabled={page * 30 >= d.count} onClick={() => setPage(page + 1)}>Older</button></div>
        </>
      )}
    </Await>
  );
}

function NotesTab({ id }: { id: string }) {
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const fail = useFail();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["staff-company-notes", id], queryFn: () => sa.companyTab<Note[]>(id, "notes") });
  const add = useMutation({
    mutationFn: () => sa.addNote(id, text.trim()),
    onSuccess: () => { setText(""); setErr(""); void qc.invalidateQueries({ queryKey: ["staff-company-notes", id] }); },
    onError: (e) => setErr(fail(e)),
  });
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <p className="hint">Internal notes. Only staff can see them; the company never does.</p>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={2000} placeholder="Write a note" aria-label="New note" style={{ flex: 1, minWidth: 240 }} />
        <RoleButton perm="notes" disabled={!text.trim() || add.isPending} onClick={() => add.mutate()}>Add note</RoleButton>
      </div>
      {err && <span className="err" role="alert">{err}</span>}
      <Await q={q}>
        {(rows) => rows.length === 0 ? <NoRows>No notes yet.</NoRows> : (
          <div style={{ display: "grid", gap: 8 }}>
            {rows.map((n) => <div key={n.id} className="panel" style={{ padding: 10 }}><div style={{ whiteSpace: "pre-wrap" }}>{n.body}</div><div className="hint">{n.author_email}, {fmtWhen(n.created_at)}</div></div>)}
          </div>
        )}
      </Await>
    </div>
  );
}

function DangerTab({ c }: { c: Detail }) {
  const [dlg, setDlg] = useState<"suspend" | "restore" | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const done = async (what: string) => { toast(what); await qc.invalidateQueries({ queryKey: ["staff-company", c.id] }); await qc.invalidateQueries({ queryKey: ["staff-companies"] }); };
  return (
    <div className="panel" style={{ padding: 16, display: "grid", gap: 12, borderColor: "var(--danger)" }}>
      <h2 style={{ fontSize: 16 }}>Danger zone</h2>
      {c.suspended ? (
        <>
          <p>This company is suspended. Its cards show as unavailable and its people cannot use it.</p>
          <div><RoleButton perm="suspendCo" onClick={() => setDlg("restore")}>Restore the company</RoleButton></div>
        </>
      ) : (
        <>
          <p>Suspending closes the company for everybody in it and shows its cards as unavailable. The owner gets an e-mail. Use it for fraud or abuse that cannot wait.</p>
          <div><RoleButton perm="suspendCo" className="btn danger" onClick={() => setDlg("suspend")}>Suspend the company</RoleButton></div>
        </>
      )}
      {dlg === "suspend" && <ReasonDialog title={`Suspend ${c.name}`} text="The owner is told by e-mail and sees the reason you write here. Everything stays as it is and can be restored." confirm="Suspend" danger typed={c.name} onClose={() => setDlg(null)} onConfirm={async (r) => { await sa.suspendCompany(c.id, r, c.name); await done("Company suspended"); }} />}
      {dlg === "restore" && <ReasonDialog title={`Restore ${c.name}`} minLength={0} confirm="Restore" onClose={() => setDlg(null)} onConfirm={async (r) => { await sa.restoreCompany(c.id, r || "Restored"); await done("Company restored"); }} />}
    </div>
  );
}
