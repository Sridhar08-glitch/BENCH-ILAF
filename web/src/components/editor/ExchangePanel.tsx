"use client";

// Owner settings for the "Share your details" form on the public card: on or off, which fields it asks
// for, and the consent sentence. Saved with the rest of the card.
import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { ToggleRow } from "@/components/app/Switch";
import { useWs } from "@/components/app/WorkspaceContext";
import { FREE_ACCESS } from "@/lib/ops/fields";
import { useI18n } from "@/lib/i18n/client";
import { tk, type MessageKey } from "@/lib/i18n";
import type { ExchangeSettings, FieldMode } from "@/lib/types";
import type { EditorApi } from "./types";

const DEFAULTS: ExchangeSettings = {
  enabled: true,
  fields: { email: "optional", phone: "optional", company: "optional", note: "optional" },
  consent_text: "",
};

const FIELDS: { key: keyof ExchangeSettings["fields"]; label: MessageKey }[] = [
  { key: "email", label: tk("common.email") },
  { key: "phone", label: tk("editor.exPhone") },
  { key: "company", label: tk("editor.company") },
  { key: "note", label: tk("editor.exMessage") },
];

/** Settings with the change applied; email and phone cannot both be off, so the other one is switched on. */
export function withFieldMode(ex: ExchangeSettings, key: keyof ExchangeSettings["fields"], mode: FieldMode): ExchangeSettings {
  const fields = { ...ex.fields, [key]: mode };
  if (fields.email === "off" && fields.phone === "off") fields[key === "email" ? "phone" : "email"] = "optional";
  return { ...ex, fields };
}

export function ExchangePanel({ ed }: { ed: EditorApi }) {
  const { current, isManager } = useWs();
  const { t } = useI18n();
  const [ex, setEx] = useState<ExchangeSettings>(ed.card.features?.exchange ?? DEFAULTS);
  const save = (next: ExchangeSettings) => {
    setEx(next);
    ed.patchNow({ features: { exchange: next } });
  };
  const locked = (ed.access ?? FREE_ACCESS).features !== "free";
  const needsOne = ex.fields.email === "optional" && ex.fields.phone === "optional";

  return (
    <div className="pane">
      <div className="sechead"><Icon name="adduser" size="s" />{t("editor.exHead")}</div>
      {locked && <div className="hint" role="status">{t("editor.settingLocked")}</div>}
      <ToggleRow
        first
        title={t("editor.exToggle")}
        hint={t("editor.exToggleHint")}
        checked={ex.enabled}
        disabled={locked}
        onChange={(v) => save({ ...ex, enabled: v })}
      />
      {ex.enabled && (
        <>
          <div className="hint">{t("editor.exAsked")}</div>
          <div className="pane" style={{ gap: 8 }}>
            {FIELDS.map((f) => (
              <label key={f.key} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <span>{t(f.label)}</span>
                <select
                  value={ex.fields[f.key]}
                  disabled={locked}
                  aria-label={t("editor.exFieldAria", { field: t(f.label) })}
                  style={{ maxWidth: 170 }}
                  onChange={(e) => save(withFieldMode(ex, f.key, e.target.value as FieldMode))}
                >
                  <option value="optional">{t("common.optional")}</option>
                  <option value="required">{t("common.required")}</option>
                  <option value="off">{t("editor.exOff")}</option>
                </select>
              </label>
            ))}
          </div>
          {needsOne && <div className="hint">{t("editor.exNeedsOne")}</div>}
          <label>
            {t("editor.exConsent")}
            <input
              dir="auto"
              value={ex.consent_text}
              disabled={locked}
              maxLength={300}
              placeholder={t("editor.exConsentPlaceholder", { name: ed.draft.name || t("editor.exOwner") })}
              onChange={(e) => save({ ...ex, consent_text: e.target.value })}
            />
          </label>
          <div className="hint">
            {t("editor.exConsentHint")}{" "}
            {isManager ? (
              <Link href="/app/settings" style={{ fontWeight: 700 }}>{t("editor.exPrivacyManage")}</Link>
            ) : (
              current.kind === "company" ? t("editor.exPrivacyCompany") : t("editor.exPrivacyAccount")
            )}
          </div>
        </>
      )}
    </div>
  );
}
