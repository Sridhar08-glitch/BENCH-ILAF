"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/Icon";
import { ErrorBox, PageHead, SkeletonBlocks, useToast } from "@/components/app/ui";
import Link from "next/link";
import { useWs } from "@/components/app/WorkspaceContext";
import { EmptyState } from "@/components/guide/EmptyState";
import { TourButton } from "@/components/guide/TourButton";
import { announce } from "@/lib/guide/api";
import { LeadDrawer } from "@/components/crm/LeadDrawer";
import s from "@/components/crm/crm.module.css";
import { Check, Dialog } from "@/components/ops/shared";
import { isolate } from "@/lib/crm/bidi";
import { crm } from "@/lib/crm/api";
import { NO_FILTERS, SOURCES, STATUSES, bulkSummary, filterCount, leadQuery, rangeProblem, statusName, type LeadFilters, type Tab } from "@/lib/crm/leads";
import type { Person } from "@/lib/crm/types";
import { useDebounced } from "@/lib/icons-client";
import { useCards } from "@/lib/hooks";
import { ShareHint } from "@/components/app/ShareHint";
import { showSharedBadge } from "@/lib/sharing/contacts";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import { reachedBy } from "@/lib/leads";
import { MAX_BULK, allSelected, pruneSelection, selectAll, toggleId } from "@/lib/ops/bulk";
import type { Lead, LeadStatus } from "@/lib/types";

const PAGE = 50;
const COLS = "26px minmax(0,1.6fr) minmax(0,.9fr) minmax(0,1fr) 140px";

type Pending = { kind: "assign"; to: Person | null } | { kind: "status"; status: LeadStatus };

export default function ContactsPage() {
  const { current, isManager, isCompany } = useWs();
  const { t, number } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("all");
  const [f, setF] = useState<LeadFilters>(NO_FILTERS);
  const [page, setPage] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [withNotes, setWithNotes] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [exportError, setExportError] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const dq = useDebounced(f.q.trim(), 300);

  // Links from e-mails: ?assignee=me, ?assignee=none and ?lead=<id>.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const a = p.get("assignee");
    if (a === "me") setTab("mine");
    else if (a === "none" && isManager) setTab("unassigned");
    const id = p.get("lead");
    if (id) setOpenId(id);
  }, [isManager]);

  const filters = useMemo(() => ({ ...f, q: dq }), [f, dq]);
  const query = leadQuery(filters, tab, page, PAGE);
  const leads = useQuery({ queryKey: ["lead-list", current.id, query], queryFn: () => crm.leads(current.id, query), placeholderData: (p) => p });
  const cards = useCards(current.id);
  const people = useQuery({ queryKey: ["lead-assignees", current.id], queryFn: () => crm.assignees(current.id), enabled: isCompany && isManager, staleTime: 60_000 });

  // Only owners and admins can ask for the internal notes; an employee's file never carries them.
  async function downloadCsv() {
    setExportError("");
    setTruncated(false);
    setDownloading(true);
    try {
      const r = await crm.downloadLeadsCsv(current.id, query, isManager && withNotes);
      if (r.truncated) setTruncated(true);
      else {
        setExporting(false);
        announce("export_done");
      }
    } catch (e) {
      setExportError(apiErrorText(e, t, "err.generic"));
    } finally {
      setDownloading(false);
    }
  }

  const rows = leads.data?.results ?? [];
  const total = leads.data?.count ?? 0;
  const ids = rows.map((l) => l.id);
  useEffect(() => setPicked((p) => pruneSelection(p, ids)), [leads.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["lead-list", current.id] });
    void qc.invalidateQueries({ queryKey: ["leads", current.id] });
  };
  const change = useMutation({
    mutationFn: (v: { id: string; status: LeadStatus }) => crm.patchLead(v.id, { status: v.status }),
    onSuccess: refresh,
    onError: () => toast(t("contacts.statusFailed")),
  });
  const bulk = useMutation({
    mutationFn: (p: Pending) =>
      p.kind === "assign"
        ? crm.bulkLeads(current.id, { action: "assign", ids: picked, assignee_id: p.to?.id ?? null })
        : crm.bulkLeads(current.id, { action: "status", ids: picked, status: p.status }),
    onSuccess: (r) => {
      toast(bulkSummary(r, t));
      setPending(null);
      setPicked([]);
      refresh();
    },
    onError: (e) => {
      setPending(null);
      toast(apiErrorText(e, t, "contacts.bulkFailed"));
    },
  });

  function set<K extends keyof LeadFilters>(k: K, v: LeadFilters[K]) {
    setF((x) => ({ ...x, [k]: v }));
    setPage(0);
  }
  const problem = rangeProblem(f, t);
  const nFilters = filterCount(f);
  const filtered = !!dq || nFilters > 0 || tab !== "all";
  const emptyTitle = filtered ? t("contacts.emptyFiltered") : t("contacts.emptyNone");
  const peopleList = people.data ?? [];
  const pickedCount = t("contacts.count", { n: picked.length });

  return (
    <div className="view">
      <PageHead title={isManager ? t("contacts.title") : t("contacts.titleMine")} sub={t("contacts.sub")}>
        <TourButton />
        <AddContactMenu />
        {isManager && <button type="button" className="btn ghost" data-guide="contacts-export" onClick={() => { setTruncated(false); setExportError(""); setExporting(true); }}><Icon name="download" size="s" />{t("contacts.exportCsv")}</button>}
      </PageHead>

      <ShareHint />

      {isCompany && (
        <div className="seg" role="group" aria-label={t("contacts.view")} style={{ alignSelf: "flex-start" }} data-guide="contacts-tabs">
          <button type="button" aria-pressed={tab === "all"} onClick={() => { setTab("all"); setPage(0); }}>{isManager ? t("contacts.tabAll") : t("contacts.tabAllMine")}</button>
          <button type="button" aria-pressed={tab === "mine"} onClick={() => { setTab("mine"); setPage(0); }}>{isManager ? t("contacts.tabMine") : t("contacts.tabGiven")}</button>
          {isManager && <button type="button" aria-pressed={tab === "unassigned"} onClick={() => { setTab("unassigned"); setPage(0); }}>{t("contacts.tabUnassigned")}</button>}
        </div>
      )}

      <div className={s.filters} data-guide="contacts-filters">
        <label className={`search ${s.grow2}`} style={{ flexDirection: "row" }}>
          <Icon name="search" size="s" />
          <input value={f.q} onChange={(e) => set("q", e.target.value)} placeholder={t("contacts.searchPlaceholder")} aria-label={t("contacts.searchAria")} dir="auto" />
        </label>
        <label>{t("contacts.status")}
          <select value={f.status} onChange={(e) => set("status", e.target.value)}>
            <option value="">{t("contacts.allStatuses")}</option>
            {STATUSES.map((st) => <option key={st.k} value={st.k}>{t(st.t)}</option>)}
          </select>
        </label>
        {isManager && isCompany && tab === "all" && (
          <label>{t("contacts.assignedTo")}
            <select value={f.assignee} onChange={(e) => set("assignee", e.target.value)}>
              <option value="">{t("contacts.anyone")}</option>
              {peopleList.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        )}
        <label>{t("contacts.source")}
          <select value={f.source} onChange={(e) => set("source", e.target.value)}>
            <option value="">{t("contacts.allSources")}</option>
            {SOURCES.map((x) => <option key={x.k} value={x.k}>{t(x.t)}</option>)}
          </select>
        </label>
        {(cards.data?.length ?? 0) > 1 && (
          <label>{t("contacts.card")}
            <select value={f.card} onChange={(e) => set("card", e.target.value)}>
              <option value="">{t("contacts.allCards")}</option>
              {cards.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
        <label className={s.dateLabel}>{t("contacts.from")}<input type="date" value={f.from} max={f.to || undefined} onChange={(e) => set("from", e.target.value)} /></label>
        <label className={s.dateLabel}>{t("contacts.to")}<input type="date" value={f.to} min={f.from || undefined} onChange={(e) => set("to", e.target.value)} /></label>
        {(nFilters > 0 || f.q) && <button type="button" className="btn ghost sm" onClick={() => { setF(NO_FILTERS); setPage(0); }}>{t("contacts.clearFilters")}</button>}
      </div>
      {problem && <span className="err" role="alert">{problem}</span>}

      {picked.length > 0 && (
        <div className={s.bulk} role="region" aria-label={t("contacts.selectionActions")}>
          <b aria-live="polite">{t("contacts.nSelected", { n: picked.length })}</b>
          <span style={{ flex: 1 }} />
          {isManager && isCompany && (
            <select aria-label={t("contacts.assignSelectedAria")} value="" onChange={(e) => e.target.value && setPending({ kind: "assign", to: e.target.value === "none" ? null : (peopleList.find((p) => p.id === e.target.value) ?? null) })}>
              <option value="">{t("contacts.assignTo")}</option>
              <option value="none">{t("contacts.nobodyUnassign")}</option>
              {peopleList.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <select aria-label={t("contacts.setStatusAria")} value="" onChange={(e) => e.target.value && setPending({ kind: "status", status: e.target.value as LeadStatus })}>
            <option value="">{t("contacts.setStatus")}</option>
            {STATUSES.map((st) => <option key={st.k} value={st.k}>{t(st.t)}</option>)}
          </select>
          <button type="button" className={s.link} onClick={() => setPicked([])}>{t("contacts.clear")}</button>
        </div>
      )}

      <div className="panel card" data-guide="contacts-list">
        <div className="trow h" style={{ ["--cols" as string]: COLS }}>
          <Check checked={allSelected(picked, ids)} indeterminate={picked.length > 0 && !allSelected(picked, ids)} onChange={(on) => setPicked(selectAll(ids, on))} label={t("contacts.selectAllPage")} />
          <span>{t("contacts.colContact")}</span><span className="hide-sm">{t("contacts.colReachedBy")}</span><span className="hide-sm">{t("contacts.assignedTo")}</span><span>{t("contacts.status")}</span>
        </div>
        {leads.isLoading ? (
          <SkeletonBlocks rows={4} />
        ) : leads.error ? (
          <ErrorBox error={leads.error} onRetry={() => void leads.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={emptyTitle}
            helpSlug={filtered ? undefined : "exchange-contacts-and-leads"}
            action={filtered ? undefined : <Link className="btn sm" href="/app/share">{t("guide.empty.contactsAction")}</Link>}
          >{filtered ? t("contacts.emptyFilteredText") : t("contacts.emptyNoneText")}</EmptyState>
        ) : (
          rows.map((l) => (
            <LeadRow
              key={l.id}
              lead={l}
              checked={picked.includes(l.id)}
              onCheck={() => setPicked((p) => (p.length >= MAX_BULK && !p.includes(l.id) ? p : toggleId(p, l.id)))}
              onOpen={() => setOpenId(l.id)}
              onStatus={(st) => change.mutate({ id: l.id, status: st })}
            />
          ))
        )}
        {total > PAGE && (
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="hint">{t("contacts.pageRange", { from: number(page * PAGE + 1), to: number(Math.min(total, (page + 1) * PAGE)), total: number(total) })}</span>
            <div className="row">
              <button type="button" className="btn ghost sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>{t("common.previous")}</button>
              <button type="button" className="btn ghost sm" disabled={(page + 1) * PAGE >= total} onClick={() => setPage((p) => p + 1)}>{t("common.next")}</button>
            </div>
          </div>
        )}
      </div>

      {openId && <LeadDrawer id={openId} ws={current.id} canAssign={isManager && isCompany} people={peopleList} onClose={() => setOpenId(null)} />}

      {pending && (
        <Dialog
          title={pending.kind === "assign"
            ? (pending.to ? t("contacts.assignTitle", { count: pickedCount, name: isolate(pending.to.name) }) : t("contacts.unassignTitle", { count: pickedCount }))
            : t("contacts.statusTitle", { count: pickedCount, status: statusName(pending.status, t) })}
          onClose={() => setPending(null)}
          footer={
            <>
              <button type="button" className="btn ghost" onClick={() => setPending(null)}>{t("common.cancel")}</button>
              <button type="button" className="btn" disabled={bulk.isPending} onClick={() => bulk.mutate(pending)}>{bulk.isPending ? t("contacts.working") : t("common.confirm")}</button>
            </>
          }
        >
          <p>{pending.kind === "assign" && pending.to ? t("contacts.assignNote", { name: isolate(pending.to.name) }) : t("contacts.skippedNote")}</p>
        </Dialog>
      )}

      {exporting && (
        <Dialog title={t("contacts.exportTitle")} onClose={() => setExporting(false)} footer={
          <>
            <button type="button" className="btn ghost" onClick={() => setExporting(false)}>{t("common.close")}</button>
            <button type="button" className="btn" disabled={downloading} onClick={() => void downloadCsv()}>{downloading ? t("contacts.working") : t("common.download")}</button>
          </>
        }>
          <p>{t("contacts.exportText", { count: t("contacts.count", { n: total }) })}</p>
          {isManager && <label className="chkrow"><input type="checkbox" className="chk" checked={withNotes} onChange={(e) => setWithNotes(e.target.checked)} />{t("contacts.includeNotes")}</label>}
          {truncated && <div className="notice warn" role="status"><Icon name="alert" /><div className="grow">{t("contacts.exportTruncated")}</div></div>}
          {exportError && <span className="err" role="alert">{exportError}</span>}
        </Dialog>
      )}
    </div>
  );
}

const initials = (name: string) => name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

/** "Add contact": the ways to put a contact in the list by hand. For now: scan a paper card (it opens inside Contacts). */
function AddContactMenu() {
  const { t } = useI18n();
  return (
    <details className="addmenu" style={{ position: "relative" }}>
      <summary className="btn" style={{ listStyle: "none", cursor: "pointer" }} data-guide="contacts-add"><Icon name="adduser" size="s" />{t("contacts.addMenu")}</summary>
      <div className="panel card" style={{ position: "absolute", insetInlineEnd: 0, zIndex: 20, minWidth: 260, marginBlockStart: 6, padding: 8 }}>
        <Link href="/app/contacts/scan" className="btn ghost block" style={{ justifyContent: "flex-start", textAlign: "start" }}>
          <Icon name="scan" size="s" />
          <span><b style={{ display: "block" }}>{t("contacts.addScan")}</b><small className="hint">{t("contacts.addScanHint")}</small></span>
        </Link>
      </div>
    </details>
  );
}

function LeadRow({ lead: l, checked, onCheck, onOpen, onStatus }: { lead: Lead; checked: boolean; onCheck: () => void; onOpen: () => void; onStatus: (s: LeadStatus) => void }) {
  const { t, date } = useI18n();
  const { role, isCompany } = useWs();
  const meta = [
    l.card_name,
    date(l.created_at, { day: "numeric", month: "short" }),
    (l.note_count ?? 0) > 0 ? t("contacts.nNotes", { n: l.note_count ?? 0 }) : "",
  ].filter(Boolean);
  return (
    <div className="trow" style={{ ["--cols" as string]: COLS }}>
      <Check checked={checked} onChange={onCheck} label={t("contacts.selectName", { name: l.name })} />
      <div className="who2">
        <span className="ini">{initials(l.name) || "?"}</span>
        <div style={{ minWidth: 0 }}>
          <button type="button" className={s.rowBtn} onClick={onOpen} aria-label={t("contacts.openName", { name: l.name })}><b dir="auto">{l.name}</b></button>
          <div className="hint"><bdi>{meta[0]}</bdi>{meta.slice(1).map((m) => <span key={m}> &middot; {m}</span>)}</div>
          <div className="only-sm hint" style={{ overflowWrap: "anywhere" }} dir="auto">{[l.company, l.email, l.phone].filter(Boolean).join(" · ")}</div>
          {l.assignee && <div className="only-sm hint">{t("contacts.assignedToName", { name: l.assignee.name })}</div>}
          {showSharedBadge(l, role, isCompany) && <div style={{ marginBlockStart: 2 }}><span className="pill accent" title={t("contacts.sharedBadgeTip")}>{t("contacts.sharedBadge")}</span></div>}
          {l.note && <div className="hint" style={{ overflowWrap: "anywhere" }} dir="auto">{t("contacts.quoted", { text: l.note })}</div>}
        </div>
      </div>
      <span className="via hide-sm">{reachedBy(l, t)}</span>
      <span className="hide-sm">
        {l.assignee ? (
          <span className={s.assignee}><span className="ini">{initials(l.assignee.name)}</span><span dir="auto">{l.assignee.name}</span></span>
        ) : <span className="hint">{t("contacts.nobody")}</span>}
      </span>
      <select value={l.status} onChange={(e) => onStatus(e.target.value as LeadStatus)} aria-label={t("contacts.statusFor", { name: l.name })}>
        {STATUSES.map((st) => <option key={st.k} value={st.k}>{t(st.t)}</option>)}
      </select>
    </div>
  );
}
