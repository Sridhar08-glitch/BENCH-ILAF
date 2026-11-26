"use client";

import { EnterpriseGate } from "@/components/app/EnterpriseLock";
import Link from "next/link";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/Icon";
import { Empty, ErrorBox, PageHead, SkeletonBlocks, useToast } from "@/components/app/ui";
import { useWs } from "@/components/app/WorkspaceContext";
import { DepartmentEditor } from "@/components/ops/DepartmentEditor";
import s from "@/components/ops/ops.module.css";
import { api } from "@/lib/api";
import { keys, useDepartments, useWorkspaceDetail } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n/client";
import { templateSummary } from "@/lib/ops/departments";
import type { Department } from "@/lib/types";

function DepartmentsPageContent() {
  const { current, isManager, isCompany } = useWs();
  const i18n = useI18n();
  const { t, list: joinList } = i18n;
  const qc = useQueryClient();
  const toast = useToast();
  const ws = useWorkspaceDetail(isCompany && isManager ? current.id : "");
  const list = useDepartments(current.id, isManager && isCompany);
  const [editing, setEditing] = useState<Department | "new" | null>(null);
  const [err, setErr] = useState<unknown>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.departments(current.id) });
    void qc.invalidateQueries({ queryKey: keys.members(current.id) });
    void qc.invalidateQueries({ queryKey: ["audit", current.id] });
  };
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteDepartment(current.id, id),
    onSuccess: () => {
      toast(t("company.deptDeleted"));
      refresh();
    },
    onError: setErr,
  });

  if (!isManager || !isCompany) {
    return (
      <div className="view">
        <PageHead title={t("company.deptsTitle")} sub={t("company.deptsSub")} />
        <div className="panel"><Empty title={t("company.deptsManagersOnly")} action={<Link className="btn sm" href="/app/cards">{t("company.goToMyCard")}</Link>} /></div>
      </div>
    );
  }

  const departments = list.data ?? [];
  return (
    <div className="view">
      <PageHead title={t("company.deptsTitle")} sub={t("company.deptsSub")}>
        <Link className="btn ghost" href="/app/team"><Icon name="adduser" size="s" />{t("company.teamBtn")}</Link>
        <button type="button" className="btn" data-guide="departments-main" onClick={() => { setErr(null); setEditing("new"); }}><Icon name="plus" size="s" />{t("company.newDept")}</button>
      </PageHead>

      {err !== null && <ErrorBox error={err} />}

      {editing && ws.data && (
        <DepartmentEditor
          key={editing === "new" ? "new" : editing.id}
          ws={ws.data}
          initial={editing === "new" ? null : editing}
          others={departments}
          onSaved={(d) => {
            toast(editing === "new" ? t("company.deptCreated", { name: d.name }) : t("company.deptSaved"));
            setEditing(null);
            refresh();
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      {list.isLoading ? <SkeletonBlocks rows={2} /> : list.error ? <ErrorBox error={list.error} onRetry={() => void list.refetch()} /> : departments.length === 0 ? (
        <div className="panel">
          <Empty title={t("company.noDepts")} action={<button type="button" className="btn sm" onClick={() => setEditing("new")}>{t("company.createFirst")}</button>}>
            {t("company.noDeptsText")}
          </Empty>
        </div>
      ) : (
        <div className={s.deptGrid}>
          {departments.map((d) => (
            <div key={d.id} className={`panel card ${s.deptCard}`}>
              <h3 dir="auto">{d.name}</h3>
              <div className="row">
                <span className="pill accent">{t("company.nPeople", { n: d.member_count })}</span>
              </div>
              <p className="hint">{templateSummary(d, i18n)}</p>
              {d.items.length > 0 && <p className="hint" dir="auto" style={{ overflowWrap: "anywhere" }}>{t("company.startsWith", { list: joinList(d.items.map((b) => b.label || b.kind)) })}</p>}
              <div className="row">
                <button type="button" className="btn ghost sm" onClick={() => { setErr(null); setEditing(d); window.scrollTo({ top: 0, behavior: "smooth" }); }}>{t("common.edit")}</button>
                <Link className="btn ghost sm" href={`/app/team`}>{t("company.seePeople")}</Link>
                <button type="button" className="btn danger sm" disabled={remove.isPending} onClick={() => { if (window.confirm(t("company.deleteDeptConfirm", { name: d.name, n: d.member_count }))) remove.mutate(d.id); }}>{t("common.delete")}</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DepartmentsPage() {
  const { t } = useI18n();
  return <EnterpriseGate feature="departments" title={t("company.deptsTitle")} sub={t("company.deptsSub")}><DepartmentsPageContent /></EnterpriseGate>;
}
