"use client";

import { MAX_TEAM } from "@/components/card/sections/helpers";
import { Avatar } from "@/components/app/ui";
import { useCards } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n/client";
import type { Card } from "@/lib/types";
import { SectionTitle } from "./SectionTitle";
import type { SectionFormProps } from "./types";
import c from "./content.module.css";

/** The colleagues a team block may show: published cards of the same workspace, not this card, not hidden from the directory. */
export function pickableCards(cards: readonly Card[] | undefined, selfId: string): Card[] {
  return (cards ?? []).filter((x) => x.id !== selfId && x.status === "published" && !x.hide_from_directory);
}

export function TeamForm({ ed, section, onChange, disabled }: SectionFormProps<"team">) {
  const { t, number } = useI18n();
  const cards = useCards(ed.card.workspace_id);
  const d = section.data;
  const picked = Array.isArray(d.cards) ? d.cards : [];
  const options = pickableCards(cards.data, ed.card.id);
  const full = picked.length >= MAX_TEAM;
  const toggle = (code: string, on: boolean) => {
    const next = on ? (picked.includes(code) || full ? picked : [...picked, code]) : picked.filter((x) => x !== code);
    onChange({ ...d, cards: next });
  };
  return (
    <>
      <SectionTitle value={d.title} disabled={disabled} onChange={(title) => onChange({ ...d, title })} placeholder={t("content.defTeam")} />
      <div className="hint">{t("content.teamHint", { n: number(MAX_TEAM) })} {t("content.teamCount", { n: number(picked.length), max: number(MAX_TEAM) })}</div>
      {cards.isLoading && <div className="skeleton" style={{ height: 48 }} />}
      {!cards.isLoading && options.length === 0 && <p className="hint">{t("content.teamNone")}</p>}
      <div className={c.people}>
        {options.map((x) => {
          const on = picked.includes(x.public_code);
          const blocked = disabled || (!on && full);
          return (
            <label key={x.id} className={c.person} aria-disabled={blocked}>
              <input type="checkbox" className="chk" checked={on} disabled={blocked} onChange={(e) => toggle(x.public_code, e.target.checked)} />
              <Avatar name={x.name} url={x.photo_url} />
              <span style={{ minWidth: 0 }}>
                <span dir="auto">{x.name || x.label || x.public_code}</span>
                {x.title && <small dir="auto">{x.title}</small>}
              </span>
            </label>
          );
        })}
      </div>
      {full && <p className="hint">{t("content.teamFull", { n: number(MAX_TEAM) })}</p>}
    </>
  );
}
