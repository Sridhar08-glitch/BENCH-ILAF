"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/Icon";
import { Avatar, Empty, ErrorBox, PageHead, SkeletonBlocks, UpgradeNotice, useToast } from "@/components/app/ui";
import { useWs } from "@/components/app/WorkspaceContext";
import { EmptyState } from "@/components/guide/EmptyState";
import { TourButton } from "@/components/guide/TourButton";
import { announce } from "@/lib/guide/api";
import { BulkActionDialog, type BulkOptions } from "@/components/ops/BulkActionDialog";
import { ReassignDialog } from "@/components/ops/ReassignDialog";
import { RemoveDialog } from "@/components/ops/RemoveDialog";
import { Check, ResultsDialog, SelectionBar } from "@/components/ops/shared";
import s from "@/components/ops/ops.module.css";
import { api, isUpgradeError, type MemberInvite } from "@/lib/api";
import { isolateLtr } from "@/lib/crm/bidi";
import { keys, useCards, useDepartments, useMembers } from "@/lib/hooks";
import { LOCALES, LOCALE_NAMES } from "@/lib/i18n/config";
import { apiErrorText, apiServerText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import { tk, type MessageKey } from "@/lib/i18n";
import { allSelected, memberActions, memberSelectable, pruneSelection, selectAll, toggleId, type MemberAction } from "@/lib/ops/bulk";
import { matchesDepartment, type DepartmentFilter } from "@/lib/ops/departments";
import { alreadyInTeam, cardState, filterMembers, freeSeats, parseInvites, seatProblem, statusCounts, type CardState, type StatusFilter } from "@/lib/team/team";
import type { BulkResult, Member, Role } from "@/lib/types";

const COLS = "minmax(0,1.6fr) 118px 132px 96px 92px minmax(170px,auto)";
const FILTERS: { id: StatusFilter; label: MessageKey }[] = [
  { id: "all", label: tk("team.statusAll") },
  { id: "invited", label: tk("team.statusInvited") },
  { id: "active", label: tk("team.statusActive") },
  { id: "suspended", label: tk("team.statusSuspended") },
];
const STATUS_NAME: Record<Member["status"], MessageKey> = {
  invited: tk("team.statusInvited"), active: tk("team.statusActive"), suspended: tk("team.statusSuspended"),
};
const ROLE_NAME: Record<Role, MessageKey> = { owner: tk("team.roleOwner"), admin: tk("team.roleAdmin"), employee: tk("team.roleEmployee") };

const statusClass = (st: Member["status"]) => (st === "active" ? "ok" : st === "invited" ? "warn" : "bad");
const CARD_LABEL: Record<CardState, { t: MessageKey; c: string }> = {
  published: { t: tk("team.cardPublished"), c: "ok" },
  draft: { t: tk("team.cardDraft"), c: "" },
  suspended: { t: tk("team.cardSuspended"), c: "bad" },
  none: { t: tk("team.cardNone"), c: "" },
};

export default function TeamPage() {
  const { current, isManager, has } = useWs();
  const { t, number } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const members = useMembers(current.id, isManager);
  const cards = useCards(isManager ? current.id : "");
  const departments = useDepartments(current.id, isManager && current.kind === "company" && has("departments"));
  const sub = current.subscription;
  const isOwner = current.role === "owner";
  const [text, setText] = useState("");
  const [role, setRole] = useState<Role>("employee");
  const [inviteDept, setInviteDept] = useState("");
  const [inviteLang, setInviteLang] = useState<"en" | "ar" | "">("");
  const [err, setErr] = useState<unknown>(null);
  const [msg, setMsg] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [deptFilter, setDeptFilter] = useState<DepartmentFilter>("all");
  const [created, setCreated] = useState<Member[] | null>(null);
  const [importResult, setImportResult] = useState<{ created: number; skipped: { row: number; reason: string }[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [selected, setSelected] = useState<string[]>([]);
  const [bulk, setBulk] = useState<MemberAction | null>(null);
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [reassigning, setReassigning] = useState<Member | null>(null);
  const [dialogErr, setDialogErr] = useState<unknown>(null);

  const list = useMemo(() => members.data ?? [], [members.data]);
  const shown = useMemo(() => filterMembers(list, query, filter).filter((m) => matchesDepartment(m, deptFilter)), [list, query, filter, deptFilter]);
  const counts = useMemo(() => statusCounts(list), [list]);
  const deptList = useMemo(() => departments.data ?? [], [departments.data]);
  const selectableIds = useMemo(() => shown.filter((m) => memberSelectable(m, isOwner)).map((m) => m.id), [shown, isOwner]);
  const pickedMembers = useMemo(() => list.filter((m) => selected.includes(m.id)), [list, selected]);

  // Keep the selection to people who are still there and still match the filters.
  useEffect(() => {
    setSelected((sel) => {
      const next = pruneSelection(sel, selectableIds);
      return next.length === sel.length ? sel : next;
    });
  }, [selectableIds]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.members(current.id) });
    void qc.invalidateQueries({ queryKey: keys.cards(current.id) });
    void qc.invalidateQueries({ queryKey: keys.workspaces });
    void qc.invalidateQueries({ queryKey: keys.departments(current.id) });
    void qc.invalidateQueries({ queryKey: ["audit", current.id] });
  };

  const invite = useMutation({
    mutationFn: (invites: MemberInvite[]) => api.inviteMembers(current.id, invites),
    onSuccess: (r) => {
      toast(t("team.invitesSent", { n: r.length }));
      announce("first_invite_sent");
      setCreated(r);
      setImportResult(null);
      setText("");
      setErr(null);
      refresh();
    },
    onError: setErr,
  });
  const update = useMutation({
    mutationFn: (v: { id: string; role?: Role; status?: "active" | "suspended" }) => api.updateMember(current.id, v.id, { role: v.role, status: v.status }),
    onSuccess: () => {
      setErr(null);
      refresh();
    },
    onError: setErr,
  });
  const setDept = useMutation({
    mutationFn: (v: { id: string; dept: string | null }) => api.updateMemberDepartment(current.id, v.id, v.dept),
    onSuccess: () => {
      setErr(null);
      refresh();
    },
    onError: setErr,
  });
  const resend = useMutation({
    mutationFn: (id: string) => api.resendInvite(current.id, id),
    onSuccess: (m) => {
      toast(t("team.resentTo", { email: isolateLtr(m.email) }));
      setErr(null);
      refresh();
    },
    onError: (e) => toast(apiErrorText(e, t, "team.resendFailed")),
  });
  const remove = useMutation({
    mutationFn: (v: { id: string; card: "keep" | "reassign" | "delete"; reassign_to: string | null }) => api.removeMember(current.id, v.id, { card: v.card, reassign_to: v.reassign_to }),
    onSuccess: (_r, v) => {
      toast(v.card === "delete" ? t("team.removedDeleted") : v.card === "reassign" ? t("team.removedReassigned") : t("team.removedKept"));
      setRemoving(null);
      setDialogErr(null);
      setErr(null);
      refresh();
    },
    onError: setDialogErr,
  });
  const reassign = useMutation({
    mutationFn: (v: { card: string; member: string | null; reset: boolean }) => api.reassignCard(v.card, v.member, v.reset),
    onSuccess: () => {
      toast(t("team.handedOver"));
      setReassigning(null);
      setDialogErr(null);
      refresh();
    },
    onError: setDialogErr,
  });
  const runBulk = useMutation({
    mutationFn: (o: BulkOptions & { action: MemberAction; ids: string[] }) => api.bulkMembers(current.id, o),
    onSuccess: (r) => {
      setBulk(null);
      setDialogErr(null);
      setBulkResult(r);
      setSelected([]);
      refresh();
    },
    onError: setDialogErr,
  });
  const importCsv = useMutation({
    mutationFn: (f: File) => api.importMembers(current.id, f),
    onSuccess: (r) => {
      setImportResult(r);
      setCreated(null);
      setErr(null);
      refresh();
    },
    onError: setErr,
  });

  if (!isManager) {
    return (
      <div className="view">
        <PageHead title={t("team.title")} sub={t("team.sub")} />
        <div className="panel">
          <Empty title={t("team.notManagerTitle")} action={<Link className="btn sm" href="/app/cards">{t("team.goMyCard")}</Link>}>
            {t("team.notManagerText")}
          </Empty>
        </div>
      </div>
    );
  }

  const emailList = (items: string[]) => items.map(isolateLtr).join(", ");

  function send(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const { invites, bad } = parseInvites(text, role);
    if (bad.length) return setMsg(t("team.badEmails", { list: emailList(bad) }));
    if (invites.length === 0) return setMsg(t("team.enterEmail"));
    const dup = alreadyInTeam(invites, list);
    if (dup.length) return setMsg(t("team.alreadyIn", { list: emailList(dup) }));
    const problem = seatProblem(sub, invites.length, t);
    if (problem) return setMsg(problem);
    setMsg("");
    invite.mutate(invites.map((i) => ({ ...i, language: inviteLang, ...(inviteDept ? { department_id: inviteDept } : {}) })));
  }

  const free = freeSeats(sub);
  const pct = sub.seats_total ? Math.min(100, (sub.seats_used / sub.seats_total) * 100) : 0;
  const choices = memberActions(isOwner);
  const bulkDef = choices.find((c) => c.id === bulk);

  return (
    <div className="view">
      <PageHead title={t("team.title")} sub={t("team.sub")}>
        <TourButton />
        <Link className="btn ghost" href="/app/departments"><Icon name="users" size="s" />{t("team.departments")}</Link>
      </PageHead>

      <div className="g2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))" }}>
        <div className="panel card">
          <div className="head"><h2><span className="chip accent"><Icon name="crown" size="s" /></span>{t("team.seats")}</h2><Link className="btn ghost sm" href="/app/billing">{t("team.buySeats")}</Link></div>
          <div className="usage">
            <div className="l"><span>{t("team.seatsUsed")}</span><b>{t("team.seatsOf", { used: number(sub.seats_used), total: number(sub.seats_total) })}</b></div>
            <div className="t"><i style={{ width: `${pct}%` }} /></div>
          </div>
          <div className="hint">
            {sub.live
              ? free > 0
                ? t("team.freeSeatsHint", { seats: t("team.freeSeatsShort", { n: free }) })
                : t("team.noFreeSeats")
              : t("team.seatsNote")}
          </div>
          {!sub.live && <div className="notice warn"><Icon name="alert" /><div className="grow">{t("team.needPlan")} <Link href="/app/billing" style={{ fontWeight: 700 }}>{t("team.seePlans")}</Link></div></div>}
        </div>

        <form className="panel card" onSubmit={send} data-guide="team-invite">
          <div className="head"><h2><span className="chip"><Icon name="adduser" size="s" /></span>{t("team.invitePeople")}</h2></div>
          <label>
            {t("team.emailAddresses")}
            <textarea value={text} onChange={(e) => { setText(e.target.value); setMsg(""); }} placeholder={t("team.emailsPlaceholder")} rows={4} dir="auto" />
          </label>
          <div className="two">
            <label>
              {t("team.role")}
              <select value={isOwner ? role : "employee"} onChange={(e) => setRole(e.target.value as Role)} disabled={!isOwner}>
                <option value="employee">{t("team.roleEmployeeOwn")}</option>
                {isOwner && <option value="admin">{t("team.roleAdminAll")}</option>}
              </select>
            </label>
            <label>
              {t("team.department")}
              <select value={inviteDept} onChange={(e) => setInviteDept(e.target.value)} aria-label={t("team.deptForInvited")}>
                <option value="">{t("team.noDepartment")}</option>
                {deptList.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
          </div>
          <label>
            {t("common.inviteLanguage")}
            <select value={inviteLang} onChange={(e) => setInviteLang(e.target.value as "en" | "ar" | "")}>
              <option value="">{t("common.langAuto")}</option>
              {LOCALES.map((code) => <option key={code} value={code}>{LOCALE_NAMES[code]}</option>)}
            </select>
          </label>
          {msg && <span className="err" role="alert">{msg}</span>}
          <div className="row">
            <button type="submit" className="btn" disabled={invite.isPending}>{invite.isPending ? t("team.sending") : t("team.send")}</button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importCsv.mutate(f); e.target.value = ""; }} />
            <button type="button" className="btn ghost" data-guide="team-import" disabled={importCsv.isPending} onClick={() => fileRef.current?.click()}><Icon name="upload" size="s" />{importCsv.isPending ? t("team.importing") : t("team.importCsv")}</button>
          </div>
          <div className="hint">{t("team.csvHint")}</div>
        </form>
      </div>

      {isUpgradeError(err) ? <UpgradeNotice error={err} /> : err ? <ErrorBox error={err} /> : null}

      {created && (
        <div className="notice" role="status">
          <Icon name="check" />
          <div className="grow">
            <b>{t("team.invitesSent", { n: created.length })}</b>
            {t("team.invitesBody", { emails: created.map((m) => isolateLtr(m.email)).join(", ") })}
          </div>
        </div>
      )}
      {importResult && (
        <div className="notice" role="status">
          <Icon name="check" />
          <div className="grow">
            <b>{importResult.skipped.length > 0 ? t("team.importAddedSkipped", { n: number(importResult.created), skipped: number(importResult.skipped.length) }) : t("team.importAdded", { n: number(importResult.created) })}</b>
            {importResult.created > 0 && `${t("team.importMail")} `}
            {importResult.skipped.length > 0 && (
              <ul style={{ margin: "4px 0 0", paddingInlineStart: 18, maxHeight: 220, overflowY: "auto" }}>
                {importResult.skipped.map((sk, i) => <li key={`${sk.row}-${i}`}>{t("team.importRow", { row: number(sk.row), reason: apiServerText(sk.reason, t) })}</li>)}
              </ul>
            )}
          </div>
        </div>
      )}

      <div className="row" style={{ alignItems: "center" }} data-guide="team-filters">
        <label className="search" style={{ flex: "1 1 240px" }}>
          <Icon name="search" size="s" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("team.searchPlaceholder")} aria-label={t("team.searchAria")} dir="auto" />
        </label>
        {deptList.length > 0 && (
          <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} aria-label={t("team.filterDeptAria")} style={{ width: "auto", maxWidth: 220 }}>
            <option value="all">{t("team.allDepartments")}</option>
            <option value="none">{t("team.noDepartment")}</option>
            {deptList.map((d) => <option key={d.id} value={d.id}>{t("team.filterCount", { label: d.name, n: number(d.member_count) })}</option>)}
          </select>
        )}
        <div className="seg" role="group" aria-label={t("team.filterStatusAria")}>
          {FILTERS.map((f) => (
            <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{t("team.filterCount", { label: t(f.label), n: number(counts[f.id]) })}</button>
          ))}
        </div>
      </div>

      <div className="panel card" data-guide="team-list">
        {selected.length > 0 && (
          <SelectionBar count={selected.length} onClear={() => setSelected([])}>
            {choices.map((c) => (
              <button key={c.id} type="button" className={`btn sm ghost ${c.danger ? "danger" : ""}`} onClick={() => { setDialogErr(null); setBulk(c.id); }}>{c.label}</button>
            ))}
          </SelectionBar>
        )}
        <div className="trow h" style={{ ["--cols" as string]: COLS }}>
          <span className={s.who}>
            <Check
              checked={allSelected(selected, selectableIds)}
              indeterminate={selected.length > 0}
              disabled={selectableIds.length === 0}
              label={t("team.selectAllShown")}
              onChange={(on) => setSelected(selectAll(selectableIds, on))}
            />
            {t("team.colMember")}
          </span>
          <span className="hide-sm">{t("team.colRole")}</span><span className="hide-sm">{t("team.department")}</span><span className="hide-sm">{t("team.colStatus")}</span><span className="hide-sm">{t("team.colCard")}</span><span>{t("team.colActions")}</span>
        </div>
        {members.isLoading ? <SkeletonBlocks rows={3} /> : members.error ? <ErrorBox error={members.error} onRetry={() => void members.refetch()} /> : list.length === 0 ? (
          <EmptyState
            title={t("team.noMembers")}
            helpSlug="invite-your-team"
            action={<button type="button" className="btn sm" onClick={() => document.querySelector<HTMLElement>('[data-guide="team-invite"] textarea')?.focus()}>{t("guide.empty.teamAction")}</button>}
          >{t("team.noMembersText")}</EmptyState>
        ) : shown.length === 0 ? (
          <Empty title={t("team.noMatch")}>{t("team.noMatchText")}</Empty>
        ) : shown.map((m) => (
          <MemberRow
            key={m.id}
            m={m}
            card={cardState(m, cards.data)}
            canChangeRole={isOwner}
            canManage={isOwner || m.role !== "admin"}
            selectable={memberSelectable(m, isOwner)}
            checked={selected.includes(m.id)}
            departments={deptList}
            resending={resend.isPending && resend.variables === m.id}
            onCheck={() => setSelected((sel) => toggleId(sel, m.id))}
            onRole={(r) => update.mutate({ id: m.id, role: r })}
            onDepartment={(id) => setDept.mutate({ id: m.id, dept: id })}
            onStatus={(st) => update.mutate({ id: m.id, status: st })}
            onResend={() => resend.mutate(m.id)}
            onReassign={() => { setDialogErr(null); setReassigning(m); }}
            onRemove={() => { setDialogErr(null); setRemoving(m); }}
          />
        ))}
      </div>

      {bulk && bulkDef && (
        <BulkActionDialog
          kind="members"
          action={bulk}
          actionLabel={bulkDef.label}
          count={selected.length}
          members={list}
          picked={pickedMembers}
          departments={deptList}
          danger={bulkDef.danger}
          pending={runBulk.isPending}
          error={dialogErr}
          onCancel={() => setBulk(null)}
          onRun={(o) => runBulk.mutate({ ...o, action: bulk, ids: selected })}
        />
      )}
      {bulkResult && <ResultsDialog result={bulkResult} onClose={() => setBulkResult(null)} />}
      {removing && (
        <RemoveDialog
          member={removing}
          members={list}
          pending={remove.isPending}
          error={dialogErr}
          onCancel={() => setRemoving(null)}
          onConfirm={(o) => remove.mutate({ id: removing.id, ...o })}
        />
      )}
      {reassigning && reassigning.card_id && (
        <ReassignDialog
          member={reassigning}
          members={list}
          pending={reassign.isPending}
          error={dialogErr}
          onCancel={() => setReassigning(null)}
          onConfirm={(memberId, reset) => reassign.mutate({ card: reassigning.card_id as string, member: memberId, reset })}
        />
      )}
    </div>
  );
}

function resendWait(m: Member, now: number): number {
  if (!m.can_resend_at) return 0;
  return Math.max(0, Math.ceil((new Date(m.can_resend_at).getTime() - now) / 60_000));
}

function MemberRow({ m, card, canChangeRole, canManage, selectable, checked, departments, resending, onCheck, onRole, onDepartment, onStatus, onResend, onReassign, onRemove }: {
  m: Member;
  card: CardState;
  canChangeRole: boolean;
  canManage: boolean;
  selectable: boolean;
  checked: boolean;
  departments: { id: string; name: string }[];
  resending: boolean;
  onCheck: () => void;
  onRole: (r: Role) => void;
  onDepartment: (id: string | null) => void;
  onStatus: (s: "active" | "suspended") => void;
  onResend: () => void;
  onReassign: () => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const isOwnerRow = m.role === "owner";
  const name = m.full_name || m.user?.full_name || m.email;
  const cl = CARD_LABEL[card];
  const [now] = useState(() => Date.now());
  const wait = m.status === "invited" ? resendWait(m, now) : 0;
  const roleText = t(ROLE_NAME[m.role]);
  const statusText = t(STATUS_NAME[m.status]);
  const closeMenu = (e: React.MouseEvent<HTMLButtonElement>) => e.currentTarget.closest("details")?.removeAttribute("open");
  return (
    <div className={`trow ${s.rowStack}`} style={{ ["--cols" as string]: COLS }}>
      <div className={s.who}>
        <Check checked={checked} onChange={onCheck} label={t("team.selectName", { name })} disabled={!selectable} />
        <Avatar name={name} url={m.user?.photo_url} />
        <div style={{ minWidth: 0 }}>
          <b dir="auto">{name}</b>
          <div className="hint ltr" style={{ overflowWrap: "anywhere" }}>{m.email}</div>
          {m.role === "employee" && m.status === "active" && typeof m.share_contacts === "boolean" && (
            <div style={{ marginBlockStart: 4 }}>
              <span className={`pill ${m.share_contacts ? "accent" : ""}`} title={t(m.share_contacts ? "team.sharesHint" : "team.privateHint")}>{t(m.share_contacts ? "team.sharesContacts" : "team.privateContacts")}</span>
            </div>
          )}
          <div className="only-sm row" style={{ marginBlockStart: 4 }}>
            <span className="pill">{roleText}</span>
            <span className={`pill ${statusClass(m.status)}`}>{statusText}</span>
            <span className={`pill ${cl.c}`}>{t(cl.t)}</span>
            {m.department_name && <span className="pill accent" dir="auto">{m.department_name}</span>}
          </div>
        </div>
      </div>
      <span className="hide-sm">
        {isOwnerRow ? <span className="pill dark">{t("team.roleOwner")}</span> : canChangeRole ? (
          <select value={m.role} onChange={(e) => onRole(e.target.value as Role)} aria-label={t("team.roleFor", { name })}>
            <option value="employee">{t("team.roleEmployee")}</option>
            <option value="admin">{t("team.roleAdmin")}</option>
          </select>
        ) : <span className="pill">{m.role === "admin" ? t("team.roleAdmin") : t("team.roleEmployee")}</span>}
      </span>
      <span className="hide-sm">
        {canManage && !isOwnerRow && departments.length > 0 ? (
          <select value={m.department_id ?? ""} onChange={(e) => onDepartment(e.target.value || null)} aria-label={t("team.deptFor", { name })}>
            <option value="">{t("team.none")}</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        ) : <span className="hint" dir="auto">{m.department_name ?? t("team.none")}</span>}
      </span>
      <span className="hide-sm"><span className={`pill ${statusClass(m.status)}`}>{statusText}</span></span>
      <span className="hide-sm"><span className={`pill ${cl.c}`}>{t(cl.t)}</span></span>
      <div className="row">
        {m.card_id && <Link className="btn ghost sm" href={`/app/cards/${m.card_id}`}>{t("team.cardLink")}</Link>}
        {m.status === "invited" && canManage && (
          <button type="button" className="btn ghost sm" disabled={resending || wait > 0} onClick={onResend} title={wait > 0 ? t("team.resendWait", { n: wait }) : t("team.resendTitle")}>
            {resending ? t("team.sending") : t("team.resend")}
          </button>
        )}
        {!isOwnerRow && canManage && (
          <details className={s.menu}>
            <summary className="btn ghost sm" aria-label={t("team.moreFor", { name })}>{t("team.more")}</summary>
            <div className={s.menuBody}>
              {m.card_id && <button type="button" onClick={(e) => { closeMenu(e); onReassign(); }}>{t("team.reassign")}</button>}
              {m.status !== "invited" && (
                <button type="button" onClick={(e) => { closeMenu(e); onStatus(m.status === "suspended" ? "active" : "suspended"); }}>{m.status === "suspended" ? t("team.restore") : t("team.suspend")}</button>
              )}
              <button type="button" className={s.bad} onClick={(e) => { closeMenu(e); onRemove(); }} aria-label={t("team.removeAria", { name })}>{t("team.remove")}</button>
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
