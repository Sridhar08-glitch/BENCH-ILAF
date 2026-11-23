"use client";

// Confirm one bulk action with the counts, and collect what the action needs (a role, a department, what to do with cards).
import { useState } from "react";
import { ErrorBox } from "@/components/app/ui";
import { useI18n } from "@/lib/i18n/client";
import { confirmText, type MemberAction, type CardBulkAction } from "@/lib/ops/bulk";
import { displayName, reassignTargets } from "@/lib/ops/offboarding";
import type { CardPolicy } from "@/lib/api";
import type { Department, Member } from "@/lib/types";
import { Dialog } from "./shared";
import { CardPolicyChoice } from "./RemoveDialog";

export interface BulkOptions {
  role?: "admin" | "employee";
  department_id?: string | null;
  card?: CardPolicy;
  reassign_to?: string | null;
}

interface Props {
  kind: "members" | "cards";
  action: MemberAction | CardBulkAction;
  actionLabel: string;
  count: number;
  members?: Member[];
  /** Picked members, to tell which of them hold a card (for the removal choices). */
  picked?: Member[];
  departments?: Department[];
  pending: boolean;
  error: unknown;
  danger?: boolean;
  onCancel: () => void;
  onRun: (o: BulkOptions) => void;
}

export function BulkActionDialog({ kind, action, actionLabel, count, members = [], picked = [], departments = [], pending, error, danger, onCancel, onRun }: Props) {
  const { t } = useI18n();
  const [role, setRole] = useState<"admin" | "employee">("employee");
  const [dept, setDept] = useState<string>("");
  const [policy, setPolicy] = useState<CardPolicy>("keep");
  const [target, setTarget] = useState<string | null>(null);
  const deptName = departments.find((d) => d.id === dept)?.name ?? null;
  const withCards = picked.filter((m) => m.card_id).length;
  // One person can only take one card, so handing cards on works for a single removal.
  const canHandOn = count === 1;
  const needTarget = action === "remove" && policy === "reassign" && canHandOn && target === null;

  function run() {
    const o: BulkOptions = {};
    if (action === "role") o.role = role;
    if (action === "department") o.department_id = dept || null;
    if (action === "remove") {
      o.card = policy;
      o.reassign_to = policy === "reassign" && target && target !== "nobody" ? target : null;
    }
    onRun(o);
  }

  return (
    <Dialog
      title={kind === "cards" ? t("company.bulkTitleCards", { action: actionLabel, n: count }) : t("company.bulkTitleMembers", { action: actionLabel, n: count })}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onCancel}>{t("common.cancel")}</button>
          <button type="button" className="btn" style={danger ? { background: "var(--danger)", borderColor: "var(--danger)" } : undefined} disabled={pending || needTarget} onClick={run}>
            {pending ? t("company.working") : t("company.bulkRun", { action: actionLabel, n: count })}
          </button>
        </>
      }
    >
      <p>{confirmText(kind, action, count, { role, department: deptName }, t)}</p>

      {action === "role" && (
        <label>
          {t("company.newRole")}
          <select value={role} onChange={(e) => setRole(e.target.value as "admin" | "employee")}>
            <option value="employee">{t("company.roleEmployeeOpt")}</option>
            <option value="admin">{t("company.roleAdminOpt")}</option>
          </select>
        </label>
      )}

      {action === "department" && (
        <label>
          {t("company.department")}
          <select value={dept} onChange={(e) => setDept(e.target.value)}>
            <option value="">{t("company.noDepartment")}</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
      )}

      {action === "remove" && withCards > 0 && (
        <CardPolicyChoice
          policy={policy}
          onPolicy={setPolicy}
          target={target}
          onTarget={setTarget}
          targets={reassignTargets(members, picked[0]?.id).map((m) => ({ id: m.id, name: displayName(m) }))}
          canPick={canHandOn}
          cardCount={withCards}
        />
      )}
      {error !== null && error !== undefined && <ErrorBox error={error} />}
    </Dialog>
  );
}
