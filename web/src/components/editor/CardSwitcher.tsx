"use client";

// The row above a card in the editor for a person with several cards: switch to another card, give this one a private
// label ("Work", "Personal") and make it the default card that "My QR" and event mode open first.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/app/ui";
import { keys, useCards } from "@/lib/hooks";
import { cardListName } from "@/lib/card-order";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import { cardOrderApi } from "@/lib/security-api";
import type { Card } from "@/lib/types";

export function CardSwitcher({ card, onLabel }: { card: Card; onLabel: (label: string) => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const cards = useCards(card.workspace_id);
  const [label, setLabel] = useState(card.label ?? "");
  const [isDefault, setIsDefault] = useState(!!card.is_default);
  const list = cards.data ?? [];
  const several = list.length > 1;

  return (
    <div className="row" style={{ gap: 10, alignItems: "end", flexWrap: "wrap" }} data-guide="card-switcher">
      {several && (
        <label style={{ minWidth: 180 }}>
          {t("cardx.switchCard")}
          <select value={card.id} onChange={(e) => router.push(`/app/cards/${e.target.value}`)}>
            {list.map((c) => <option key={c.id} value={c.id}>{cardListName(c, t("cards.untitled"))}{c.is_default ? ` (${t("cardx.default")})` : ""}</option>)}
          </select>
        </label>
      )}
      <label style={{ minWidth: 180 }}>
        {t("cardx.label")}
        <input dir="auto" value={label} maxLength={40} placeholder={t("cardx.labelPh")} onChange={(e) => { setLabel(e.target.value); onLabel(e.target.value); }} />
      </label>
      {several && !isDefault && (
        <button
          type="button"
          className="btn ghost sm"
          onClick={async () => {
            try {
              await cardOrderApi.makeDefault(card.id);
              setIsDefault(true);
              void qc.invalidateQueries({ queryKey: keys.cards(card.workspace_id) });
              toast(t("cardx.defaultSet"));
            } catch (e) {
              toast(apiErrorText(e, t, "settings.saveFailed"));
            }
          }}
        >
          {t("cardx.makeDefault")}
        </button>
      )}
      {several && isDefault && <span className="pill ok">{t("cardx.isDefault")}</span>}
    </div>
  );
}
