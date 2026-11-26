"use client";

// What extras (video, shop, hours, booking ...) a company lets its employees add under their cards: any, only some, or none.
// Saved at once. Used by the Brand page (team step) and by the field rules page.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { kindName } from "@/components/editor/ContentTab";
import { ErrorBox, SkeletonBlocks, useToast } from "@/components/app/ui";
import s from "@/components/brand/brand.module.css";
import { api } from "@/lib/api";
import { keys } from "@/lib/hooks";
import { tk, type MessageKey } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { extrasOf, ruleChanges, withExtras } from "@/lib/ops/fields";
import { EXTRA_KINDS, type ExtraKind, type ExtrasMode, type FieldRules } from "@/lib/types";

const MODES: [ExtrasMode, MessageKey, MessageKey][] = [
  ["all", tk("brand.extrasAll"), tk("brand.extrasAllHint")],
  ["some", tk("brand.extrasSome"), tk("brand.extrasSomeHint")],
  ["none", tk("brand.extrasNone"), tk("brand.extrasNoneHint")],
];

export function ExtrasRule({ wsId }: { wsId: string }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: keys.fieldRules(wsId), queryFn: () => api.fieldRules(wsId) });
  const save = useMutation({
    mutationFn: (next: FieldRules) => api.updateFieldRules(wsId, ruleChanges(q.data as FieldRules, next)),
    onSuccess: (r) => {
      qc.setQueryData(keys.fieldRules(wsId), r);
      void qc.invalidateQueries({ queryKey: ["commerce-access"] });
      toast(t("brand.rightsSaved"));
    },
    onError: () => toast(t("brand.rightsFailed")),
  });
  if (q.isLoading) return <SkeletonBlocks rows={1} />;
  if (q.error || !q.data) return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />;
  const rules = q.data;
  const allowed = extrasOf(rules);
  return (
    <div className="pane">
      <h3>{t("brand.extrasTitle")}</h3>
      <div role="radiogroup" aria-label={t("brand.extrasTitle")} className={s.rights}>
        {MODES.map(([v, title, hint]) => (
          <button key={v} type="button" role="radio" aria-checked={rules.extras === v} className={`${s.right} ${rules.extras === v ? s.rightOn : ""}`} disabled={save.isPending} onClick={() => rules.extras !== v && save.mutate(withExtras(rules, v))}>
            <b>{t(title)}</b>
            <small>{t(hint)}</small>
          </button>
        ))}
      </div>
      {rules.extras === "some" && (
        <div role="group" aria-label={t("brand.extrasPick")} className={s.kinds}>
          {EXTRA_KINDS.map((k) => {
            const on = rules.extra_kinds.includes(k);
            return (
              <label key={k} className={s.kind}>
                <input type="checkbox" checked={on} disabled={save.isPending} onChange={() => save.mutate(withExtras(rules, "some", on ? rules.extra_kinds.filter((x: ExtraKind) => x !== k) : [...rules.extra_kinds, k]))} />
                {kindName(k, t)}
              </label>
            );
          })}
        </div>
      )}
      <p className="hint">{t("brand.extrasNote", { list: allowed.length ? allowed.map((k) => kindName(k, t)).join(", ") : t("brand.extrasNoneAllowed") })}</p>
    </div>
  );
}
