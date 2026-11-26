"use client";

// Enterprise requests: companies that asked for a quote. Staff set the seats and the price per seat for that customer (the owner is
// e-mailed and accepts in Billing), or decline. There is no price list.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/app/ui";
import { Dialog } from "@/components/ops/shared";
import { sa, type EnterpriseRequestRow } from "@/lib/staff-admin/api";
import { fmtMoney, STATUS_TONE, toMinor } from "@/lib/staff-admin/enterprise";
import { fmtWhen } from "@/lib/staff-admin/format";
import { Await, Chips, NoRows, Page, Pager, Pill, RoleButton, Table, td, useFail } from "./ui";

const FILTERS = [{ key: "open", label: "Open" }, { key: "accepted", label: "Accepted" }, { key: "all", label: "All" }] as const;
type Filter = (typeof FILTERS)[number]["key"];

function QuoteDialog({ row, onClose }: { row: EnterpriseRequestRow; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const fail = useFail();
  const [seats, setSeats] = useState(String(row.quoted_seats ?? row.seats_wanted));
  const [price, setPrice] = useState(row.quoted_price_per_seat_minor ? String(row.quoted_price_per_seat_minor / 100) : "");
  const [note, setNote] = useState(row.staff_note);
  const [err, setErr] = useState("");
  const minor = toMinor(price);
  const n = Number(seats);
  const floor = Math.max(1, row.seats_used);
  const valid = Number.isInteger(n) && n >= floor && minor !== null;
  async function save() {
    if (minor === null) return;
    setErr("");
    try {
      await sa.quoteEnterprise(row.id, { seats: n, price_per_seat_minor: minor, note: note.trim() || undefined });
      toast(`Quote sent to the owner of ${row.company}`);
      await qc.invalidateQueries({ queryKey: ["staff-enterprise"] });
      onClose();
    } catch (e) { setErr(fail(e)); }
  }
  return (
    <Dialog title={`Quote for ${row.company}`} onClose={onClose} footer={<><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button type="button" className="btn" disabled={!valid} onClick={() => void save()}>Send the quote</button></>}>
      <div style={{ display: "grid", gap: 10 }}>
        <p className="hint" style={{ margin: 0 }}>The owner gets this by e-mail and can accept and pay in Billing. It renews every year. The company asked for {row.seats_wanted} seats and uses {row.seats_used}.</p>
        <label style={{ display: "grid", gap: 4 }}>Seats (at least {floor})<input type="number" min={floor} value={seats} onChange={(e) => setSeats(e.target.value)} /></label>
        <label style={{ display: "grid", gap: 4 }}>Price per seat per year ({row.currency})<input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="25.00" /></label>
        {minor !== null && valid && <div className="hint">Total per year: <b>{fmtMoney(minor * n, row.currency)}</b></div>}
        <label style={{ display: "grid", gap: 4 }}>Note for the customer (optional)<textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        {err && <span className="err" role="alert">{err}</span>}
      </div>
    </Dialog>
  );
}

function DeclineDialog({ row, onClose }: { row: EnterpriseRequestRow; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const fail = useFail();
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  async function save() {
    setErr("");
    try {
      await sa.declineEnterprise(row.id, { note: note.trim() || undefined });
      toast(`Declined. The owner of ${row.company} was told.`);
      await qc.invalidateQueries({ queryKey: ["staff-enterprise"] });
      onClose();
    } catch (e) { setErr(fail(e)); }
  }
  return (
    <Dialog title={`Decline ${row.company}`} onClose={onClose} footer={<><button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button type="button" className="btn danger" onClick={() => void save()}>Decline</button></>}>
      <div style={{ display: "grid", gap: 10 }}>
        <p className="hint" style={{ margin: 0 }}>The owner gets an e-mail. Their current plan does not change.</p>
        <label style={{ display: "grid", gap: 4 }}>Note for the customer (optional)<textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        {err && <span className="err" role="alert">{err}</span>}
      </div>
    </Dialog>
  );
}

export default function EnterpriseRequests() {
  const [status, setStatus] = useState<Filter>("open");
  const [page, setPage] = useState(1);
  const [dlg, setDlg] = useState<{ row: EnterpriseRequestRow; what: "quote" | "decline" } | null>(null);
  const q = useQuery({ queryKey: ["staff-enterprise", status, page], queryFn: () => sa.enterpriseRequests({ status, page: String(page) }), placeholderData: (p) => p, refetchInterval: 60_000 });
  return (
    <Page title="Enterprise requests" sub="Companies that asked for Enterprise. There is no price list: you set the seats and the price for each customer.">
      <Chips items={FILTERS} value={status} onChange={(v) => { setStatus(v); setPage(1); }} />
      <Await q={q}>
        {(d) => (
          <>
            {d.results.length === 0 ? <NoRows>No requests here.</NoRows> : (
              <Table head={["Company", "Asked", "Quote", "Status", "Actions"]}>
                {d.results.map((r) => (
                  <tr key={r.id}>
                    <td style={td}><b>{r.company}</b>{r.requested_by && <div className="hint">{r.requested_by.full_name} {r.requested_by.email}</div>}{r.phone && <div className="hint">{r.phone}</div>}</td>
                    <td style={td}>{r.seats_wanted} seats wanted ({r.seats_used} in use){r.message && <div className="hint" style={{ whiteSpace: "pre-wrap" }}>{r.message}</div>}<div className="hint">{fmtWhen(r.created_at)}</div></td>
                    <td style={td}>{r.quoted_seats === null ? "-" : <>{r.quoted_seats} seats at {fmtMoney(r.quoted_price_per_seat_minor, r.currency)}<div className="hint">{fmtMoney(r.quoted_total_minor, r.currency)} a year</div>{r.staff_note && <div className="hint">{r.staff_note}</div>}</>}</td>
                    <td style={td}><Pill tone={STATUS_TONE[r.status]}>{r.status}</Pill>{r.quoted_by && <div className="hint">by {r.quoted_by}</div>}</td>
                    <td style={td}>
                      {(r.status === "requested" || r.status === "quoted") && (
                        <div className="row">
                          <RoleButton perm="plans" className="btn sm" onClick={() => setDlg({ row: r, what: "quote" })}>{r.status === "quoted" ? "Change the quote" : "Quote"}</RoleButton>
                          <RoleButton perm="plans" className="btn sm ghost" onClick={() => setDlg({ row: r, what: "decline" })}>Decline</RoleButton>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
            )}
            <Pager page={d.page} pages={d.pages} count={d.count} onPage={setPage} />
          </>
        )}
      </Await>
      {dlg?.what === "quote" && <QuoteDialog row={dlg.row} onClose={() => setDlg(null)} />}
      {dlg?.what === "decline" && <DeclineDialog row={dlg.row} onClose={() => setDlg(null)} />}
    </Page>
  );
}
