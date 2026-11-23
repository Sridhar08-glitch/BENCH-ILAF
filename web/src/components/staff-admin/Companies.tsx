"use client";

// Companies: a table with search, filters, paging and bulk select; the company page with its tabs lives in CompanyDetail.tsx.
import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/app/ui";
import { sa } from "@/lib/staff-admin/api";
import { countryName } from "@/lib/countries";
import { fmtDay } from "@/lib/staff-admin/format";
import { Await, NoRows, OnlyFor, Page, Pager, Pill, ReasonDialog, Table, td, toneOf, useDebounced } from "./ui";

export const STATUS_WORDS: Record<string, string> = {
  active: "Active", expired: "Plan ended", no_plan: "No plan", deletion_pending: "Deletion pending", suspended: "Suspended", trialing: "Trial",
};

export default function Companies() {
  const [q, setQ] = useState("");
  const [plan, setPlan] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("name");
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<string[]>([]);
  const [bulk, setBulk] = useState<"suspend" | "restore" | null>(null);
  const toast = useToast();
  const qc = useQueryClient();
  const term = useDebounced(q);
  const list = useQuery({ queryKey: ["staff-companies", term, plan, status, sort, page], queryFn: () => sa.companies({ q: term, plan, status, sort, page: String(page) }), placeholderData: (p) => p });
  const reset = () => { setPage(1); setPicked([]); };
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <Page title="Companies" sub="Every company that uses the product.">
      <div className="row">
        <input type="search" value={q} onChange={(e) => { setQ(e.target.value); reset(); }} placeholder="Search by company name or owner email" aria-label="Search companies" style={{ minWidth: 260 }} />
        <select value={plan} onChange={(e) => { setPlan(e.target.value); reset(); }} aria-label="Plan">
          <option value="">Every plan</option>
          {list.data?.plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
          <option value="none">No plan</option>
        </select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); reset(); }} aria-label="Status">
          <option value="">Every status</option>
          {["active", "suspended", "no_plan", "deletion_pending"].map((s) => <option key={s} value={s}>{STATUS_WORDS[s]}</option>)}
        </select>
        <select value={sort} onChange={(e) => { setSort(e.target.value); reset(); }} aria-label="Sort by">
          <option value="name">Sort by name</option>
          <option value="newest">Newest first</option>
          <option value="cards">Most cards</option>
        </select>
      </div>
      {picked.length > 0 && (
        <OnlyFor perm="suspendCo">
          <div className="notice" role="region" aria-label="Selected companies">
            <div className="grow row"><b>{picked.length} selected</b>
              <button type="button" className="btn sm danger" onClick={() => setBulk("suspend")}>Suspend</button>
              <button type="button" className="btn sm ghost" onClick={() => setBulk("restore")}>Restore</button>
              <button type="button" className="btn sm ghost" onClick={() => setPicked([])}>Clear</button>
            </div>
          </div>
        </OnlyFor>
      )}
      <Await q={list}>
        {(d) => (
          <>
            {d.results.length === 0 ? <NoRows>No company matches.</NoRows> : (
              <Table head={["", "Company", "Country", "Plan", "Seats", "Status", "Owner", "Joined"]}>
                {d.results.map((c) => (
                  <tr key={c.id}>
                    <td style={td}><OnlyFor perm="suspendCo"><input type="checkbox" checked={picked.includes(c.id)} onChange={() => toggle(c.id)} aria-label={`Select ${c.name}`} /></OnlyFor></td>
                    <td style={td}><Link href={`/staff/companies/${c.id}`}><b>{c.name}</b></Link></td>
                    <td style={td}>{c.country ? countryName(c.country, "en") : "-"}</td>
                    <td style={td}>{c.plan ?? "-"}</td>
                    <td style={td}>{c.seats_used} / {c.seats_total}</td>
                    <td style={td}><Pill tone={toneOf(c.status)}>{STATUS_WORDS[c.status] ?? c.status}</Pill></td>
                    <td style={td}>{c.owner_email}</td>
                    <td style={td}>{fmtDay(c.created_at)}</td>
                  </tr>
                ))}
              </Table>
            )}
            <Pager page={d.page} pages={d.pages} count={d.count} onPage={setPage} />
          </>
        )}
      </Await>
      {bulk && (
        <ReasonDialog
          title={bulk === "suspend" ? `Suspend ${picked.length} companies` : `Restore ${picked.length} companies`}
          text={bulk === "suspend" ? "Their cards show as unavailable and their people cannot sign in to the company. Each owner gets an e-mail." : "They become active again and each owner gets an e-mail."}
          confirm={bulk === "suspend" ? "Suspend" : "Restore"} danger={bulk === "suspend"} minLength={bulk === "suspend" ? 5 : 0}
          onClose={() => setBulk(null)}
          onConfirm={async (reason) => {
            const r = await sa.bulkCompanies(picked, bulk, reason || "Restored");
            const ok = r.results.filter((x) => x.ok).length;
            toast(`${ok} of ${r.results.length} done`);
            setPicked([]);
            await qc.invalidateQueries({ queryKey: ["staff-companies"] });
          }}
        />
      )}
    </Page>
  );
}
