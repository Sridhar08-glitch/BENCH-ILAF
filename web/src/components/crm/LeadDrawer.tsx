"use client";

// One contact in a side panel: details, status, who has it, internal notes and the timeline.
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/Icon";
import { ErrorBox, SkeletonBlocks, useToast } from "@/components/app/ui";
import { ApiError } from "@/lib/api";
import { isolate } from "@/lib/crm/bidi";
import { crm } from "@/lib/crm/api";
import { STATUSES, describeActivity } from "@/lib/crm/leads";
import type { Person } from "@/lib/crm/types";
import { apiErrorText, apiFieldText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import { reachedBy } from "@/lib/leads";
import type { LeadStatus } from "@/lib/types";
import s from "./crm.module.css";

interface Props {
  id: string;
  ws: string;
  canAssign: boolean;
  people: Person[];
  onClose: () => void;
}

export function LeadDrawer({ id, ws, canAssign, people, onClose }: Props) {
  const { t, date } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [note, setNote] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const q = useQuery({ queryKey: ["lead", id], queryFn: () => crm.lead(id) });
  const when = (iso: string) => date(iso, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", k);
    ref.current?.focus();
    return () => document.removeEventListener("keydown", k);
  }, [onClose]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["lead", id] });
    void qc.invalidateQueries({ queryKey: ["leads", ws] });
    void qc.invalidateQueries({ queryKey: ["lead-list", ws] });
  };
  const patch = useMutation({
    mutationFn: (b: { status?: LeadStatus; assignee_id?: string | null }) => crm.patchLead(id, b),
    onSuccess: (d) => {
      qc.setQueryData(["lead", id], d);
      refresh();
    },
    onError: (e) => toast(apiErrorText(e, t, "contacts.saveFailed")),
  });
  const add = useMutation({
    mutationFn: (body: string) => crm.addNote(id, body),
    onSuccess: () => {
      setNote("");
      refresh();
    },
    onError: (e) => toast(e instanceof ApiError ? (apiFieldText(e, "body", t) ?? apiErrorText(e, t)) : t("contacts.noteFailed")),
  });

  const l = q.data;
  return (
    <div className={s.drawerBack} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={s.drawer} role="dialog" aria-modal="true" aria-label={t("contacts.drawerAria")} tabIndex={-1} ref={ref}>
        <div className={s.drawerHead}>
          <div style={{ minWidth: 0 }}>
            <h2 dir="auto">{l?.name ?? t("contacts.drawerFallback")}</h2>
            {l && <div className="hint"><bdi>{l.card_name}</bdi> &middot; {when(l.created_at)}</div>}
          </div>
          <button type="button" aria-label={t("common.close")} onClick={onClose} style={{ background: "none", border: 0, cursor: "pointer" }}><Icon name="x2" size="s" /></button>
        </div>
        <div className={s.drawerBody}>
          {q.isLoading ? (
            <SkeletonBlocks rows={4} />
          ) : q.error || !l ? (
            <ErrorBox error={q.error ?? new Error(t("contacts.notFound"))} onRetry={() => void q.refetch()} />
          ) : (
            <>
              <section className={s.sec}>
                <h3>{t("contacts.secDetails")}</h3>
                <dl className={s.facts}>
                  <dt>{t("contacts.colReachedBy")}</dt><dd>{reachedBy(l, t)}</dd>
                  {l.company && <><dt>{t("contacts.factCompany")}</dt><dd dir="auto">{l.company}</dd></>}
                  {l.email && <><dt>{t("contacts.factEmail")}</dt><dd><a className="ltr" href={`mailto:${l.email}`}>{l.email}</a></dd></>}
                  {l.phone && <><dt>{t("contacts.factPhone")}</dt><dd><a className="ltr" href={`tel:${l.phone.replace(/[^\d+]/g, "")}`}>{l.phone}</a></dd></>}
                  {(l.meeting_times?.length ?? 0) > 0 && <><dt>{t("contacts.factTimes")}</dt><dd dir="auto">{l.meeting_times?.join(", ")}</dd></>}
                  {l.note && <><dt>{t("contacts.factMessage")}</dt><dd dir="auto">{l.note}</dd></>}
                  <dt>{t("contacts.factConsent")}</dt><dd>{l.consented_at ? t("contacts.consentAgreed", { date: when(l.consented_at) }) : t("contacts.consentTeam")}</dd>
                </dl>
              </section>

              <section className={s.sec}>
                <h3>{t("contacts.status")}</h3>
                <div className={s.statusRow} role="group" aria-label={t("contacts.status")}>
                  {STATUSES.map((st) => (
                    <button key={st.k} type="button" className="chipb" aria-pressed={l.status === st.k} disabled={patch.isPending} onClick={() => l.status !== st.k && patch.mutate({ status: st.k })}>{t(st.t)}</button>
                  ))}
                </div>
              </section>

              <section className={s.sec}>
                <h3>{t("contacts.assignedTo")}</h3>
                {canAssign ? (
                  <select
                    aria-label={t("contacts.assignedTo")}
                    value={l.assignee?.id ?? ""}
                    disabled={patch.isPending}
                    onChange={(e) => patch.mutate({ assignee_id: e.target.value || null })}
                  >
                    <option value="">{t("contacts.nobody")}</option>
                    {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                ) : (
                  <span dir="auto">{l.assignee ? l.assignee.name : t("contacts.nobody")}</span>
                )}
                {canAssign && l.assignee && <span className="hint">{t("contacts.emailedOnAssign", { name: isolate(l.assignee.name) })}</span>}
              </section>

              <section className={s.sec}>
                <h3>{t("contacts.secNotes")}</h3>
                {l.notes.length === 0 && <p className="hint">{t("contacts.noNotes")}</p>}
                {l.notes.map((n) => (
                  <div className={s.note} key={n.id}><small><bdi>{n.author || t("contacts.someone")}</bdi> &middot; {when(n.created_at)}</small><span dir="auto">{n.body}</span></div>
                ))}
                <form
                  className="pane"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (note.trim()) add.mutate(note.trim());
                  }}
                >
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("contacts.notePlaceholder")} aria-label={t("contacts.noteAria")} maxLength={2000} rows={3} dir="auto" />
                  <div><button type="submit" className="btn sm" disabled={add.isPending || !note.trim()}>{add.isPending ? t("contacts.addingNote") : t("contacts.addNote")}</button></div>
                </form>
              </section>

              <section className={s.sec}>
                <h3>{t("contacts.secTimeline")}</h3>
                <ol className={s.timeline}>
                  {[...l.activity].reverse().map((a) => (
                    <li key={a.id}>{describeActivity(a, t)}<small>{when(a.created_at)}</small></li>
                  ))}
                </ol>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
