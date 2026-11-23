"use client";

// Staff and permissions: the staff table (role, second step, last sign-in, sessions), invitations, role changes,
// removal, second-step reset, and the permissions page read from the server's own table.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/app/ui";
import { Dialog } from "@/components/ops/shared";
import { sa, type SecuritySession, type StaffPerson } from "@/lib/staff-admin/api";
import { fmtWhen } from "@/lib/staff-admin/format";
import { countryName } from "@/lib/staff-admin/frame";
import { ROLE_NAMES, type StaffRole } from "@/lib/staff-admin/roles";
import { Await, Page, Pill, ReasonDialog, RoleButton, Table, Tabs, td, useCan, useFail } from "./ui";

const ROLES: StaffRole[] = ["admin", "support", "read_only"];

function InviteDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const fail = useFail();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("support");
  const [err, setErr] = useState("");
  async function go() {
    setErr("");
    try {
      const r = await sa.invite(email.trim(), role);
      toast(r.granted ? "Role given" : "Invitation e-mail sent");
      await qc.invalidateQueries({ queryKey: ["staff-team"] });
      onClose();
    } catch (e) { setErr(fail(e)); }
  }
  return (
    <Dialog title="Invite staff" onClose={onClose} footer={<><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button type="button" className="btn" disabled={!email.includes("@")} onClick={() => void go()}>Invite</button></>}>
      <div style={{ display: "grid", gap: 10 }}>
        <p className="hint" style={{ margin: 0 }}>If the address already has an account, it gets the role at once. Otherwise it gets an e-mail asking to create an account first.</p>
        <label style={{ display: "grid", gap: 4 }}>E-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label style={{ display: "grid", gap: 4 }}>Role<select value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_NAMES[r]}</option>)}</select></label>
        {err && <span className="err" role="alert">{err}</span>}
      </div>
    </Dialog>
  );
}

function PeopleTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const canEdit = useCan("staff");
  const [invite, setInvite] = useState(false);
  const [act, setAct] = useState<{ p: StaffPerson; what: "remove" | "reset" | "revoke" | "role"; role?: StaffRole } | null>(null);
  const q = useQuery({ queryKey: ["staff-team"], queryFn: sa.team });
  const done = async (msg: string) => { toast(msg); await qc.invalidateQueries({ queryKey: ["staff-team"] }); };
  return (
    <Await q={q}>
      {(d) => (
        <>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="hint">Staff sessions last {d.session_hours} hours. A session used from a new network address is written to the audit log.</span>
            <RoleButton perm="staff" onClick={() => setInvite(true)}>Invite staff</RoleButton>
          </div>
          <Table head={["Person", "Role", "Two-step", "Last signed in", "Sessions", ""]}>
            {d.people.map((p) => (
              <tr key={p.id}>
                <td style={td}><b>{p.full_name || p.email}</b><div className="hint">{p.email}</div></td>
                <td style={td}>
                  <select value={p.staff_role} aria-label={`Role of ${p.email}`} disabled={!canEdit}
                    onChange={(e) => setAct({ p, what: "role", role: e.target.value as StaffRole })}>
                    {ROLES.map((r) => <option key={r} value={r}>{ROLE_NAMES[r]}</option>)}
                  </select>
                </td>
                <td style={td}>{p.totp_enrolled ? <Pill tone="ok">On</Pill> : <Pill tone="warn">Not set up</Pill>}<div className="hint">{p.recovery_codes_left} recovery codes left</div></td>
                <td style={td}>{fmtWhen(p.last_sign_in)}</td>
                <td style={td}>{p.sessions.length === 0 ? "-" : p.sessions.map((s) => <div key={s.id} className="hint">{[s.device, s.country && countryName(s.country)].filter(Boolean).join(", ") || s.method}, until {fmtWhen(s.expires_at)}{s.new_address_seen ? " (new address seen)" : ""}</div>)}</td>
                <td style={td}><div className="row">
                  <RoleButton perm="staff" className="btn sm ghost" onClick={() => setAct({ p, what: "revoke" })}>End sessions</RoleButton>
                  <RoleButton perm="staff" className="btn sm ghost" onClick={() => setAct({ p, what: "reset" })}>Reset two-step</RoleButton>
                  <RoleButton perm="staff" className="btn sm danger" onClick={() => setAct({ p, what: "remove" })}>Remove</RoleButton>
                </div></td>
              </tr>
            ))}
          </Table>
          {invite && <InviteDialog onClose={() => setInvite(false)} />}
          {act?.what === "remove" && <ReasonDialog title={`Remove ${act.p.email} from the staff`} text="They keep their customer account. The last admin cannot be removed." confirm="Remove" danger minLength={0} onClose={() => setAct(null)} onConfirm={async (reason) => { await sa.removeStaff(act.p.id, reason || undefined); await done("Removed"); }} />}
          {act?.what === "reset" && <ReasonDialog title={`Reset two-step for ${act.p.email}`} text="Their authenticator and recovery codes are deleted. They set it up again at their next visit." confirm="Reset" danger minLength={0} onClose={() => setAct(null)} onConfirm={async (reason) => { await sa.resetTotp(act.p.id, reason || undefined); await done("Two-step reset"); }} />}
          {act?.what === "revoke" && <ReasonDialog title={`End all sessions of ${act.p.email}`} confirm="End sessions" minLength={0} onClose={() => setAct(null)} onConfirm={async (reason) => { const r = await sa.revokeSessions(act.p.id, reason || undefined); await done(`${r.revoked} sessions ended`); }} />}
          {act?.what === "role" && act.role && <ReasonDialog title={`Change the role of ${act.p.email} to ${ROLE_NAMES[act.role]}`} text="Their staff sessions end, so they sign in with their code again. The last admin cannot be demoted." confirm="Change role" minLength={5} onClose={() => setAct(null)} onConfirm={async (reason) => { await sa.setRole(act.p.id, act.role as StaffRole, reason); await done("Role changed"); }} />}
        </>
      )}
    </Await>
  );
}

function SessionRow({ s, onRevoke, who }: { s: SecuritySession; onRevoke: () => void; who?: boolean }) {
  const place = [s.device || "Unknown device", s.country && countryName(s.country)].filter(Boolean).join(", ");
  return (
    <div className="row" style={{ justifyContent: "space-between", borderBlockStart: "1px solid var(--line)", paddingBlockStart: 10, alignItems: "flex-start" }} data-testid="security-session">
      <span style={{ display: "grid", gap: 2, minWidth: 0 }}>
        <b dir="auto">{who ? `${s.full_name || s.email}: ` : ""}{place} {s.current && <Pill tone="ok">This session</Pill>} {s.new_address_seen && <Pill tone="warn">New address seen</Pill>}</b>
        <span className="hint">Started {fmtWhen(s.started_at)}, last used {fmtWhen(s.last_seen_at)}, ends {fmtWhen(s.expires_at)}{who && s.email ? ` (${s.email})` : ""}</span>
      </span>
      <button type="button" className="btn sm ghost" onClick={onRevoke}>{s.current ? "Sign out here" : "Revoke"}</button>
    </div>
  );
}

function SecurityTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const [target, setTarget] = useState<SecuritySession | null>(null);
  const q = useQuery({ queryKey: ["staff-security"], queryFn: sa.security });
  return (
    <Await q={q}>
      {(d) => (
        <>
          <section className="panel" style={{ padding: 14, display: "grid", gap: 10 }} aria-label="Your sessions">
            <h2 style={{ fontSize: 16 }}>Your staff sessions</h2>
            <p className="hint" style={{ margin: 0 }}>Every browser where you passed the two-step check. End any you do not recognise or no longer use.</p>
            {d.mine.length === 0 && <span className="hint">No open sessions.</span>}
            {d.mine.map((s) => <SessionRow key={s.id} s={s} onRevoke={() => setTarget(s)} />)}
          </section>
          {d.everyone && (
            <>
              <section className="panel" style={{ padding: 14, display: "grid", gap: 8 }} aria-label="Two-step status">
                <h2 style={{ fontSize: 16 }}>Two-step verification <Pill tone="ok">{d.everyone.two_step.filter((p) => p.enrolled).length} of {d.everyone.two_step.length} on</Pill></h2>
                {d.everyone.two_step.map((p) => (
                  <div key={p.id} className="row" style={{ justifyContent: "space-between", borderBlockStart: "1px solid var(--line)", paddingBlockStart: 8 }}>
                    <span><b>{p.full_name || p.email}</b> <span className="hint">{p.email}</span></span>
                    {p.enrolled ? <Pill tone="ok">Authenticator app</Pill> : <Pill tone="warn">Not set up</Pill>}
                  </div>
                ))}
              </section>
              <section className="panel" style={{ padding: 14, display: "grid", gap: 10 }} aria-label="Other people's sessions">
                <h2 style={{ fontSize: 16 }}>Sessions of the rest of the team</h2>
                {d.everyone.sessions.length === 0 && <span className="hint">Nobody else has an open session.</span>}
                {d.everyone.sessions.map((s) => <SessionRow key={s.id} s={s} who onRevoke={() => setTarget(s)} />)}
              </section>
            </>
          )}
          {target && (
            <ReasonDialog
              title={target.current ? "Sign out of this browser" : `End this session${target.email ? ` of ${target.email}` : ""}`} confirm={target.current ? "Sign out" : "End session"} danger minLength={0}
              text={target.current ? "You will enter your authenticator code again to come back." : "The person has to enter their authenticator code again on that browser."}
              onClose={() => setTarget(null)}
              onConfirm={async (reason) => {
                await sa.revokeSession(target.id, reason || undefined);
                toast("Session ended. Logged.");
                await qc.invalidateQueries({ queryKey: ["staff-security"] });
                if (target.current) { await qc.invalidateQueries({ queryKey: ["staff-me"] }); }
              }}
            />
          )}
        </>
      )}
    </Await>
  );
}

function PermissionsTab() {
  const q = useQuery({ queryKey: ["staff-permissions"], queryFn: sa.permissions });
  return (
    <Await q={q}>
      {(m) => (
        <>
          <p className="hint">This table is read from the server. It is the one the server enforces, so it cannot disagree with what actually happens.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
            {m.roles.map((r) => <div key={r.key} className="panel" style={{ padding: 12 }}><b>{ROLE_NAMES[r.key]}</b><p className="sub" style={{ margin: 0 }}>{r.summary}</p></div>)}
          </div>
          <Table head={["What", "Group", ...m.roles.map((r) => ROLE_NAMES[r.key])]}>
            {m.permissions.map((p) => (
              <tr key={p.key}><td style={td}>{p.label}</td><td style={td}>{p.group}</td>
                {m.roles.map((r) => <td key={r.key} style={td}>{p.roles.includes(r.key) ? <Pill tone="ok">Yes</Pill> : <span className="hint">No</span>}</td>)}</tr>
            ))}
          </Table>
        </>
      )}
    </Await>
  );
}

export default function StaffTeam() {
  const [tab, setTab] = useState<"people" | "permissions" | "security">("people");
  return (
    <Page title="Staff and permissions" sub="Who is on the team and what each role can do.">
      <Tabs tabs={[{ key: "people", label: "People" }, { key: "permissions", label: "Permissions" }, { key: "security", label: "Security" }]} value={tab} onChange={setTab} />
      {tab === "people" ? <PeopleTab /> : tab === "permissions" ? <PermissionsTab /> : <SecurityTab />}
    </Page>
  );
}
