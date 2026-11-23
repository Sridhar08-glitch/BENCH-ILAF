"use client";

// Hand a company card to another member, or to nobody. The card keeps its link and QR code.
import { useState } from "react";
import { ErrorBox } from "@/components/app/ui";
import { useI18n } from "@/lib/i18n/client";
import { tk } from "@/lib/i18n";
import { displayName, reassignTargets, targetProblem } from "@/lib/ops/offboarding";
import type { Member } from "@/lib/types";
import { Dialog, SLOT, WithSlot } from "./shared";

export function ReassignDialog({ member, members, pending, error, onCancel, onConfirm }: {
  member: Member;
  members: Member[];
  pending: boolean;
  error: unknown;
  onCancel: () => void;
  onConfirm: (memberId: string | null, resetDetails: boolean) => void;
}) {
  const { t } = useI18n();
  const [target, setTarget] = useState<string>("");
  const [reset, setReset] = useState(true);
  const targets = reassignTargets(members, member.id);
  const problem = targetProblem(members, member.id, t);
  const toNobody = target === "nobody";
  const statusWord = (status: string) => (status === "suspended" ? t(tk("company.statusSuspended")) : status === "invited" ? t(tk("company.statusInvited")) : status);
  return (
    <Dialog
      title={t("company.reassignTitle")}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onCancel}>{t("common.cancel")}</button>
          <button type="button" className="btn" disabled={pending || !target} onClick={() => onConfirm(toNobody ? null : target, !toNobody && reset)}>
            {pending ? t("company.handingOver") : t("company.reassignTitle")}
          </button>
        </>
      }
    >
      <p><WithSlot text={t("company.reassignText", { name: SLOT })}><b dir="auto">{displayName(member)}</b></WithSlot></p>
      <label>
        {t("company.whoGets")}
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">{t("company.choose")}</option>
          <option value="nobody">{t("company.nobodyShared")}</option>
          {targets.map((m) => <option key={m.id} value={m.id}>{m.status !== "active" ? t("company.memberStatus", { name: displayName(m), status: statusWord(m.status) }) : displayName(m)}</option>)}
        </select>
      </label>
      {problem && <div className="hint">{problem}</div>}
      {target && !toNobody && (
        <label style={{ flexDirection: "row", alignItems: "center", gap: 10, fontWeight: 600, color: "var(--ink)" }}>
          <input type="checkbox" checked={reset} onChange={(e) => setReset(e.target.checked)} style={{ width: "auto" }} />
          {t("company.putName")}
        </label>
      )}
      {target && !toNobody && <div className="hint">{t("company.reassignNote")}</div>}
      {error !== null && error !== undefined && <ErrorBox error={error} />}
    </Dialog>
  );
}
