"use client";

// People and cards: one search box over names, e-mail addresses, card codes and companies; the list of every card and the
// list of every person below it; a card drawer with suspend and restore; a person page with sign-in methods and sessions.
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/app/ui";
import { Dialog } from "@/components/ops/shared";
import { sa } from "@/lib/staff-admin/api";
import { cardStatusWord } from "@/lib/staff-admin/card-data";
import { fmtDay, fmtNumber, fmtWhen } from "@/lib/staff-admin/format";
import CardsList from "./CardsList";
import { StaffCardThumb } from "./StaffCardThumb";
import PeopleList from "./PeopleList";
import { Await, Page, Pill, ReasonDialog, RoleButton, toneOf, useDebounced } from "./ui";

export function CardDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [dlg, setDlg] = useState<"suspend" | "restore" | null>(null);
  const q = useQuery({ queryKey: ["staff-card", id], queryFn: () => sa.card(id) });
  const refresh = async (msg: string) => { toast(msg); await qc.invalidateQueries(); };
  return (
    <Dialog title="Card" onClose={onClose} wide>
      <Await q={q}>
        {(d) => {
          const c = d.card;
          return (
            <div style={{ display: "grid", gap: 14 }}>
              <div className="row" style={{ alignItems: "flex-start", gap: 16 }}>
                <StaffCardThumb card={c} width={200} />
                <div style={{ display: "grid", gap: 6, minWidth: 220, flex: 1 }}>
                  <h3 style={{ fontSize: 18 }}>{c.name || "(no name)"}</h3>
                  <span className="sub">{c.title}{c.company ? `, ${c.company}` : ""}</span>
                  <span className="row"><Pill tone={toneOf(c.status)}>{cardStatusWord(c)}</Pill></span>
                  <span>Company: <Link href={`/staff/companies/${d.company.id}`}>{d.company.name}</Link></span>
                  <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "4px 14px", margin: 0 }}>
                    <dt className="hint">Owner</dt><dd style={{ margin: 0, overflowWrap: "anywhere" }}>{c.owner ? `${c.owner.full_name ? `${c.owner.full_name}, ` : ""}${c.owner.email}` : "None"}</dd>
                    <dt className="hint">Card holder e-mail</dt><dd style={{ margin: 0, overflowWrap: "anywhere" }}>{d.details.holder_email || "None"}</dd>
                    {d.details.card_email && <><dt className="hint">E-mail on the card</dt><dd style={{ margin: 0, overflowWrap: "anywhere" }}>{d.details.card_email}</dd></>}
                    <dt className="hint">Created</dt><dd style={{ margin: 0 }}>{fmtDay(d.details.created_at)}</dd>
                  </dl>
                  <span className="hint">{fmtNumber(c.stats.views)} views, {fmtNumber(c.stats.scans)} scans, {fmtNumber(c.stats.saves)} saves, {fmtNumber(c.stats.leads)} leads</span>
                  <span><a href={c.public_url} target="_blank" rel="noopener noreferrer" onClick={() => { void sa.lookPublicPage(c.id).catch(() => undefined); }}>Open the public page</a> <span className="hint">(code {c.public_code})</span></span>
                  <div className="row">
                    {c.status === "suspended"
                      ? <RoleButton perm="suspendCard" onClick={() => setDlg("restore")}>Restore the card</RoleButton>
                      : <RoleButton perm="suspendCard" className="btn danger" onClick={() => setDlg("suspend")}>Suspend the card</RoleButton>}
                  </div>
                </div>
              </div>
              {d.reports.length > 0 && (
                <section><h4>Reports about this card</h4>
                  {d.reports.map((r) => <div key={r.id} className="row"><Link href={`/staff/abuse?open=${r.id}`}>{r.reason}</Link><Pill tone={toneOf(r.status)}>{r.status}</Pill><span className="hint">{fmtWhen(r.created_at)}</span></div>)}
                </section>
              )}
              <section><h4>History</h4>
                {d.history.length === 0 && <span className="hint">Nothing recorded.</span>}
                {d.history.map((h, i) => <div key={i} className="row" style={{ justifyContent: "space-between" }}><span>{h.text} <span className="hint">by {h.who || "system"} ({h.kind})</span></span><span className="hint">{fmtWhen(h.at)}</span></div>)}
              </section>
              {dlg === "suspend" && <ReasonDialog title={`Suspend ${c.name}`} text="The public page shows that the card is no longer active. The company cannot restore it itself." confirm="Suspend" danger onClose={() => setDlg(null)} onConfirm={async (r) => { await sa.suspendCard(c.id, r); await refresh("Card suspended"); }} />}
              {dlg === "restore" && <ReasonDialog title={`Restore ${c.name}`} minLength={0} confirm="Restore" onClose={() => setDlg(null)} onConfirm={async (r) => { await sa.restoreCard(c.id, r || "Restored"); await refresh("Card restored"); }} />}
            </div>
          );
        }}
      </Await>
    </Dialog>
  );
}

export function UserDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const q = useQuery({ queryKey: ["staff-user", id], queryFn: () => sa.user(id) });
  return (
    <Dialog title="Person" onClose={onClose} wide>
      <Await q={q}>
        {(u) => (
          <div style={{ display: "grid", gap: 12 }}>
            <div><h3 style={{ fontSize: 18 }}>{u.full_name || u.email}</h3><span className="sub">{u.email}</span></div>
            <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "6px 16px", margin: 0 }}>
              <dt className="hint">Sign-in methods</dt><dd style={{ margin: 0 }}>{[u.sign_in_methods.password && "Password", u.sign_in_methods.google && "Google"].filter(Boolean).join(" and ") || "None"}</dd>
              <dt className="hint">E-mail confirmed</dt><dd style={{ margin: 0 }}>{u.email_verified ? "Yes" : "No"}</dd>
              <dt className="hint">Language</dt><dd style={{ margin: 0 }}>{u.language ?? "Follows the browser"}</dd>
              <dt className="hint">Last signed in</dt><dd style={{ margin: 0 }}>{fmtWhen(u.last_sign_in)}</dd>
              <dt className="hint">Joined</dt><dd style={{ margin: 0 }}>{fmtWhen(u.created_at)}</dd>
              <dt className="hint">Product updates by e-mail</dt><dd style={{ margin: 0 }}>{u.product_updates ? "Yes" : "No"}</dd>
              {u.deletion_due_at && <><dt className="hint">Deletion due</dt><dd style={{ margin: 0 }}>{fmtWhen(u.deletion_due_at)}</dd></>}
            </dl>
            <section><h4>Companies</h4>
              {u.memberships.length === 0 && <span className="hint">None.</span>}
              {u.memberships.map((m) => <div key={m.company_id} className="row">{m.kind === "company" ? <Link href={`/staff/companies/${m.company_id}`}>{m.company}</Link> : <span>Personal space</span>}<Pill>{m.role}</Pill><Pill tone={toneOf(m.status)}>{m.status}</Pill></div>)}
            </section>
            <section><h4>Sessions (read only)</h4>
              {u.sessions.length === 0 && <span className="hint">No open sessions.</span>}
              {u.sessions.map((s) => <div key={s.id} className="hint">Started {fmtWhen(s.started_at)}, renews until {fmtWhen(s.expires_at)}</div>)}
              <div style={{ marginBlockStart: 8 }}><RoleButton perm="signOutUser" className="btn danger sm" onClick={() => setConfirm(true)}>Sign out everywhere</RoleButton></div>
            </section>
            {confirm && (
              <ReasonDialog title="Sign this person out everywhere" text="Every refresh token is revoked. Open pages stop working within an hour at the latest." confirm="Sign out" danger onClose={() => setConfirm(false)}
                onConfirm={async (reason) => { const r = await sa.signOutUser(id, reason); toast(`${r.revoked} sessions ended`); await qc.invalidateQueries({ queryKey: ["staff-user", id] }); }} />
            )}
          </div>
        )}
      </Await>
    </Dialog>
  );
}

export default function People() {
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [card, setCard] = useState<string | null>(null);
  const [user, setUser] = useState<string | null>(params.get("user"));
  const term = useDebounced(q.trim());
  const res = useQuery({ queryKey: ["staff-search", term], queryFn: () => sa.search(term), enabled: term.length >= 2, placeholderData: (p) => p });
  return (
    <Page title="People and cards" sub="Every card and every person on the product, newest first. Type to narrow both lists by name, e-mail address, card link or company; two letters or more also find companies.">
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter people, or search e-mail, card code, company" aria-label="Global search" style={{ maxWidth: 480 }} autoFocus />
      <CardsList term={term} onOpen={setCard} />
      <h2 style={{ fontSize: 16 }}>People</h2>
      <PeopleList term={term} onOpen={setUser} />
      {term.length >= 2 && res.data && (
        <>
          {res.data.companies.length > 0 && (
            <section style={{ display: "grid", gap: 6 }}><h2 style={{ fontSize: 16 }}>Companies</h2>
              {res.data.companies.map((c) => <Link key={c.id} href={`/staff/companies/${c.id}`} className="panel" style={{ padding: 10, textDecoration: "none" }}><b>{c.name}</b> <span className="hint">{c.owner_email}</span></Link>)}
            </section>
          )}
          {res.data.companies.length === 0 && <span className="hint">No company matches either.</span>}
        </>
      )}
      {card && <CardDrawer id={card} onClose={() => setCard(null)} />}
      {user && <UserDrawer id={user} onClose={() => setUser(null)} />}
    </Page>
  );
}
