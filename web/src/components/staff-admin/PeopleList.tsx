"use client";

// Everyone on the product, newest first, without typing: filters, sorting, paging, a table on wide screens and cards on phones.
// The search text comes from the page's search box and narrows the same list.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ErrorBox, SkeletonBlocks } from "@/components/app/ui";
import { sa, type PersonRow } from "@/lib/staff-admin/api";
import { countryName } from "@/lib/countries";
import { fmtDay } from "@/lib/staff-admin/format";
import { NO_FILTERS, PEOPLE_PAGE_SIZE, anyFilter, moreCompanies, pageCount, peopleQuery, personBadges, planText, rangeText, type PeopleFilters } from "@/lib/staff-admin/people";
import styles from "./PeopleList.module.css";
import { NoRows, Pill, toneOf } from "./ui";

function Badges({ p }: { p: PersonRow }) {
  const list = personBadges(p);
  if (list.length === 0) return null;
  return <span className={styles.badges}>{list.map((b) => <Pill key={b.text} tone={b.tone}>{b.text}</Pill>)}</span>;
}

function PlanCell({ p }: { p: PersonRow }) {
  return <Pill tone={toneOf(p.personal.state)}>{planText(p.personal)}</Pill>;
}

function CompaniesCell({ p }: { p: PersonRow }) {
  if (p.companies.length === 0) return <span className={styles.small}>None</span>;
  const more = moreCompanies(p);
  return (
    <span className={styles.companies}>
      {p.companies.map((c) => <span key={c.id}>{c.name} <span className={styles.small}>({c.role}{c.plan ? `, ${c.plan}` : ""}{c.suspended ? ", suspended" : ""})</span></span>)}
      {more > 0 && <span className={styles.small}>and {more} more</span>}
    </span>
  );
}

export default function PeopleList({ term, onOpen }: { term: string; onOpen: (id: string) => void }) {
  const [f, setF] = useState<PeopleFilters>(NO_FILTERS);
  const [pageOf, setPageOf] = useState<{ term: string; page: number }>({ term, page: 1 });
  const page = pageOf.term === term ? pageOf.page : 1;
  const filters: PeopleFilters = { ...f, q: term, page };
  const q = useQuery({ queryKey: ["staff-people", filters], queryFn: () => sa.people(peopleQuery(filters)), placeholderData: (prev) => prev });
  const set = (patch: Partial<PeopleFilters>) => { setF((old) => ({ ...old, ...patch })); setPageOf({ term, page: 1 }); };
  const data = q.data;
  const pages = data ? pageCount(data.count) : 1;
  const open = (id: string) => () => onOpen(id);

  return (
    <section style={{ display: "grid", gap: 10 }} aria-label="People">
      <div className={styles.filters} role="group" aria-label="Filter people">
        <select value={f.plan} onChange={(e) => set({ plan: e.target.value })} aria-label="Plan">
          <option value="">Every plan</option>
          {data?.plans.map((p) => <option key={p.code} value={p.code}>{p.name} ({p.kind})</option>)}
          <option value="none">No plan</option>
        </select>
        <select value={f.status} onChange={(e) => set({ status: e.target.value })} aria-label="Account status">
          <option value="">Every status</option>
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
          <option value="deletion_pending">Deletion scheduled</option>
        </select>
        <select value={f.role} onChange={(e) => set({ role: e.target.value })} aria-label="Customer or staff">
          <option value="">Customers and staff</option>
          <option value="customer">Customers only</option>
          <option value="staff">Staff only</option>
        </select>
        <select value={f.hasCompany} onChange={(e) => set({ hasCompany: e.target.value })} aria-label="Company membership">
          <option value="">With or without a company</option>
          <option value="true">In a company</option>
          <option value="false">Not in a company</option>
        </select>
        <label>Joined from <input type="date" value={f.joinedFrom} onChange={(e) => set({ joinedFrom: e.target.value })} aria-label="Joined from" /></label>
        <label>to <input type="date" value={f.joinedTo} onChange={(e) => set({ joinedTo: e.target.value })} aria-label="Joined to" /></label>
        <select value={f.sort} onChange={(e) => set({ sort: e.target.value })} aria-label="Sort by">
          <option value="newest">Newest first</option>
          <option value="name">Name</option>
          <option value="last_active">Last signed in</option>
        </select>
        {(anyFilter({ ...f, q: "" })) && <button type="button" className="btn ghost sm" onClick={() => set({ ...NO_FILTERS, sort: f.sort })}>Clear filters</button>}
      </div>

      {q.isLoading && <SkeletonBlocks rows={4} />}
      {!q.isLoading && (q.error || !data) && <ErrorBox error={q.error} onRetry={() => void q.refetch()} />}
      {data && (data.results.length === 0
        ? <NoRows>{anyFilter(filters) ? "No person matches. Change the search or the filters." : "Nobody has signed up yet."}</NoRows>
        : (
          <>
            <div className={`panel ${styles.tableWrap}`}>
              <table className={styles.table}>
                <caption className="sr-only">People, {rangeText(data.offset, data.results.length, data.count)}</caption>
                <thead><tr>{["Person", "Joined", "Last signed in", "Plan", "Companies", "Cards", "Country", "Two-step", "Status"].map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
                <tbody>
                  {data.results.map((p) => (
                    <tr key={p.id} onClick={open(p.id)}>
                      <td>
                        <button type="button" className={styles.nameBtn} onClick={(e) => { e.stopPropagation(); onOpen(p.id); }}>
                          <span><b>{p.full_name || p.email}</b><Badges p={p} /></span>
                          {p.full_name && <span className={styles.small}>{p.email}</span>}
                          {!p.email_verified && <span className={styles.small}>E-mail not confirmed</span>}
                        </button>
                      </td>
                      <td className={styles.nowrap}>{fmtDay(p.created_at)}</td>
                      <td className={styles.nowrap}>{p.last_sign_in ? fmtDay(p.last_sign_in) : <span className={styles.small}>Never</span>}</td>
                      <td><PlanCell p={p} /></td>
                      <td><CompaniesCell p={p} /></td>
                      <td className={styles.nowrap}>{p.cards} <span className={styles.small}>({p.cards_published} published)</span></td>
                      <td>{p.country ? countryName(p.country, "en") : "-"}</td>
                      <td>{p.staff_role !== "none" ? (p.two_step ? "On" : "Not set up") : "-"}</td>
                      <td><Pill tone={toneOf(p.status)}>{p.status === "active" ? "Active" : p.status === "disabled" ? "Disabled" : "Deletion scheduled"}</Pill></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className={styles.cards} aria-label="People">
              {data.results.map((p) => (
                <li key={p.id}>
                  <button type="button" className={styles.card} onClick={open(p.id)}>
                    <span className={styles.cardTop}><span><b>{p.full_name || p.email}</b><Badges p={p} /><br /><span className={styles.small}>{p.full_name ? p.email : ""}</span>{!p.email_verified && <><br /><span className={styles.small}>E-mail not confirmed</span></>}</span><PlanCell p={p} /></span>
                    <dl className={styles.cardGrid}>
                      <dt>Joined</dt><dd>{fmtDay(p.created_at)}</dd>
                      <dt>Last signed in</dt><dd>{p.last_sign_in ? fmtDay(p.last_sign_in) : "Never"}</dd>
                      <dt>Cards</dt><dd>{p.cards} ({p.cards_published} published)</dd>
                      <dt>Companies</dt><dd><CompaniesCell p={p} /></dd>
                      {p.country && <><dt>Country</dt><dd>{countryName(p.country, "en")}</dd></>}
                    </dl>
                  </button>
                </li>
              ))}
            </ul>

            <div className={styles.foot}>
              <span className="hint" role="status" aria-live="polite">{rangeText(data.offset, data.results.length, data.count)}</span>
              <span className="row">
                <button type="button" className="btn ghost sm" disabled={page <= 1} onClick={() => setPageOf({ term, page: page - 1 })}>Previous</button>
                <span className="hint">Page {Math.min(page, pages)} of {pages}</span>
                <button type="button" className="btn ghost sm" disabled={page >= pages} onClick={() => setPageOf({ term, page: page + 1 })}>Next</button>
              </span>
            </div>
          </>
        ))}
    </section>
  );
}

export { PEOPLE_PAGE_SIZE };
