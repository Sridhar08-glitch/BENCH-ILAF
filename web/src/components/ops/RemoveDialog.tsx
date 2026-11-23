"use client";

// Remove one person: choose what happens to their card (keep it switched off, hand it on, delete it).
import { useState } from "react";
import { ErrorBox } from "@/components/app/ui";
import type { CardPolicy } from "@/lib/api";
import { useI18n } from "@/lib/i18n/client";
import { POLICIES, canConfirmRemoval, displayName, reassignTargets, removalOptions, targetProblem } from "@/lib/ops/offboarding";
import type { Member } from "@/lib/types";
import { Dialog, SLOT, WithSlot } from "./shared";
import s from "./ops.module.css";

/** The three choices, with the colleague picker when handing the card on. */
export function CardPolicyChoice({ policy, onPolicy, target, onTarget, targets, canPick, cardCount }: {
  policy: CardPolicy;
  onPolicy: (p: CardPolicy) => void;
  target: string | null;
  onTarget: (t: string | null) => void;
  targets: { id: string; name: string }[];
  /** False when several people are removed at once: a card can then only go to nobody. */
  canPick: boolean;
  cardCount: number;
}) {
  const { t } = useI18n();
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
      <legend className="sechead" style={{ marginBlockEnd: 8 }}>{t("company.whatHappens", { n: cardCount })}</legend>
      {POLICIES.map((p) => (
        <label key={p.id} className={s.choice} data-on={policy === p.id}>
          <input type="radio" name="card-policy" checked={policy === p.id} onChange={() => onPolicy(p.id)} />
          <div>
            <b>{t(p.title)}</b>
            <span>{t(p.text)}</span>
            {p.id === "reassign" && policy === "reassign" && (
              <div style={{ marginBlockStart: 8 }}>
                {canPick ? (
                  <select aria-label={t("company.whoGets")} value={target ?? ""} onChange={(e) => onTarget(e.target.value || null)} onClick={(e) => e.stopPropagation()}>
                    <option value="">{t("company.chooseWhoGets")}</option>
                    <option value="nobody">{t("company.nobodyShared")}</option>
                    {targets.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                ) : (
                  <span>{t("company.severalNote")}</span>
                )}
                {canPick && targets.length === 0 && <div className="hint" style={{ marginBlockStart: 6 }}>{targetProblem([], null, t)}</div>}
              </div>
            )}
          </div>
        </label>
      ))}
    </fieldset>
  );
}

export function RemoveDialog({ member, members, pending, error, onCancel, onConfirm }: {
  member: Member;
  members: Member[];
  pending: boolean;
  error: unknown;
  onCancel: () => void;
  onConfirm: (o: { card: CardPolicy; reassign_to: string | null }) => void;
}) {
  const { t } = useI18n();
  const [policy, setPolicy] = useState<CardPolicy>("keep");
  const [target, setTarget] = useState<string | null>(null);
  const name = displayName(member);
  const hasCard = !!member.card_id;
  const ok = canConfirmRemoval(policy, target, hasCard);
  return (
    <Dialog
      title={t("company.removeTitle", { name })}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onCancel}>{t("common.cancel")}</button>
          <button type="button" className="btn" style={{ background: "var(--danger)", borderColor: "var(--danger)" }} disabled={pending || !ok} onClick={() => onConfirm(removalOptions(policy, target))}>
            {pending ? t("company.removing") : t("company.removePerson")}
          </button>
        </>
      }
    >
      <p><WithSlot text={t("company.removeText", { name: SLOT })}><bdi>{name}</bdi></WithSlot></p>
      {hasCard ? (
        <CardPolicyChoice
          policy={policy}
          onPolicy={setPolicy}
          target={target}
          onTarget={setTarget}
          targets={reassignTargets(members, member.id).map((m) => ({ id: m.id, name: displayName(m) }))}
          canPick
          cardCount={1}
        />
      ) : (
        <p className="hint"><WithSlot text={t("company.hasNoCard", { name: SLOT })}><bdi>{name}</bdi></WithSlot></p>
      )}
      {error !== null && error !== undefined && <ErrorBox error={error} />}
    </Dialog>
  );
}
