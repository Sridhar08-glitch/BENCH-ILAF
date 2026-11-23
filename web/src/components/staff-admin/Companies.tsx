"use client";

// Companies: a table with search, filters, paging and bulk select (export, announce, suspend); the company page with its tabs lives in CompanyDetail.tsx.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/app/ui";
import { sa } from "@/lib/staff-admin/api";
import { countryName } from "@/lib/countries";
import { announceHref, exportQuery, seatsNearlyFull, storeAnnounceSelection, togglePage } from "@/lib/staff-admin/companies";
import { fmtDay } from "@/lib/staff-admin/format";
import { Await, NoRows, Page, Pager, Pill, ReasonDialog, RoleButton, td, toneOf, useCan, useDebounced, useFail } from "./ui";

export const STATUS_WORDS: Record<string, string> = {
  active: "Active", expired: "Plan ended", no_plan: "No plan", deletion_pending: "Deletion pending", suspended: "Suspended", trialing: "Trial",
};

const HEAD = ["Company", "Country", "Plan", "Seats", "Cards", "Status", "Owner", "Joined"];

/** The companies table: a first column with the select-all box for the rows on this page. */
function CompaniesTable({ canPick, allPicked, onToggleAll, children }: { canPick: boolean; allPicked: boolean; onToggleAll: () => void; children: React.ReactNode }) {
  return (
    <div className="panel" style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th scope="col" style={{ padding: 10, inlineSize: 36 }}>
              {canPick ? <input type="checkbox" checked={allPicked} onChange={onToggleAll} aria-label="Select all companies on this page" /> : <span className="sr-only">Select</span>}
            </th>
            {HEAD.map((h) => <th key={h} scope="col" style={{ textAlign: "start", padding: 10, fontSize: 12, color: "var(--mute)", whiteSpace: "nowrap" }}>{h}</th>)}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export default function Companies() {
  const [q, setQ] = useState("");
  const [plan, setPlan] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("name");
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<string[]>([]);
  const [bulk, setBulk] = useState<"suspend" | "restore" | null>(null);
  const toast = useToast();
  const fail = useFail();
  const router = useRouter();
  const canExport = useCan("export");
  const canSuspend = useCan("suspendCo");
  const canPick = canExport || canSuspend;
  const [exporting, setExporting] = useState(false);
  const qc = useQueryClient();
  const term = useDebounced(q);
  const list = useQuery({ queryKey: ["staff-companies", term, plan, status, sort, page], queryFn: () => sa.companies({ q: term, plan, status, sort, page: String(page) }), placeholderData: (p) => p });
  const reset = () => { setPage(1); setPicked([]); };
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const exportCsv = async () => {
    setExporting(true);
    try {
      await sa.downloadCompanies(exportQuery(picked, { q: term, plan, status, sort }));
      toast(`${picked.length} ${picked.length === 1 ? "company" : "companies"} exported. Logged.`);
    } catch (e) {
      toast(fail(e));
    } finally {
      setExporting(false);
    }
  };
  const announce = () => {
    storeAnnounceSelection(picked);
    router.push(announceHref(picked));
  };
  return (
    <Page title="Companies" sub="Every company that uses the product.">
      <div className="row">
        <input type="search" value={q} onChange={(e) => { setQ(e.target.value); reset(); }} placeholder="Company, owner, e-mail or country" aria-label="Search companies" style={{ minWidth: 260 }} />
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
      {picked.length > 0 && canPick && (
        <div className="notice" role="region" aria-label="Selected companies">
          <div className="grow row"><b>{picked.length} selected</b>
            <RoleButton perm="export" className="btn sm ghost" disabled={exporting} onClick={() => void exportCsv()}>Export CSV</RoleButton>
            <RoleButton perm="announce" className="btn sm ghost" onClick={announce}>Announce to selected</RoleButton>
            <RoleButton perm="suspendCo" className="btn sm danger" onClick={() => setBulk("suspend")}>Suspend</RoleButton>
            <RoleButton perm="suspendCo" className="btn sm ghost" onClick={() => setBulk("restore")}>Restore</RoleButton>
            <button type="button" className="btn sm ghost" onClick={() => setPicked([])}>Clear</button>
          </div>
        </div>
      )}
      <Await q={list}>
        {(d) => (
          <>
            {d.results.length === 0 ? <NoRows>No company matches.</NoRows> : (
              <CompaniesTable
                canPick={canPick} allPicked={d.results.length > 0 && d.results.every((c) => picked.includes(c.id))}
                onToggleAll={() => setPicked((p) => togglePage(p, d.results.map((c) => c.id)))}
              >
                {d.results.map((c) => (
                  <tr key={c.id}>
                    <td style={td}>{canPick && <input type="checkbox" checked={picked.includes(c.id)} onChange={() => toggle(c.id)} aria-label={`Select ${c.name}`} />}</td>
                    <td style={td}><Link href={`/staff/companies/${c.id}`}><b>{c.name}</b></Link></td>
                    <td style={td}>{c.country ? countryName(c.country, "en") : "-"}</td>
                    <td style={td}>{c.plan ?? "-"}</td>
                    <td style={{ ...td, ...(seatsNearlyFull(c.seats_used, c.seats_total) ? { color: "var(--warn)", fontWeight: 700 } : {}) }} title={seatsNearlyFull(c.seats_used, c.seats_total) ? "90% or more of the seats are taken" : undefined}>{c.seats_used} / {c.seats_total}</td>
                    <td style={td}>{c.cards ?? 0}</td>
                    <td style={td}><Pill tone={toneOf(c.status)}>{STATUS_WORDS[c.status] ?? c.status}</Pill></td>
                    <td style={td}>{c.owner_email}</td>
                    <td style={td}>{fmtDay(c.created_at)}</td>
                  </tr>
                ))}
              </CompaniesTable>
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
