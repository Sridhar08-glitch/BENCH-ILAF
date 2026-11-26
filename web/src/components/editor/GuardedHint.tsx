"use client";

import s from "@/components/ops/ops.module.css";
import { fieldHint } from "@/lib/ops/fields";
import { useI18n } from "@/lib/i18n/client";
import type { FieldPermission } from "@/lib/types";

/** The one-line note under a company-guarded field: locked, needs approval, or waiting for an admin. Nothing when free. */
export function GuardedHint({ perm, waiting }: { perm: FieldPermission; waiting: boolean }) {
  const { t } = useI18n();
  const hint = fieldHint("bio", perm, waiting, t);
  if (!hint) return null;
  return <div className={`${s.fieldHint} ${waiting ? s.wait : s.lock}`} role="status">{hint}</div>;
}
