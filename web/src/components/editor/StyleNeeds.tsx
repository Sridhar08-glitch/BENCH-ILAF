"use client";

// Tells the owner what the chosen style actually shows and what the card still lacks for it, and lets them fill it in right
// there. Driven by the design's own data (lib/library/styleNeeds), so every style gets its own list without a hand-made case.
import { Icon } from "@/components/Icon";
import { GuardedField } from "@/components/ops/GuardedField";
import { useI18n } from "@/lib/i18n/client";
import { styleNeeds, type CardHas, type Need } from "@/lib/library/styleNeeds";
import type { Design } from "@/lib/types";
import { BioField } from "./BioField";
import { CoverUpload } from "./design/CoverUpload";
import { FIELD_LABELS, type GuidedKey } from "./guided";
import type { EditorApi } from "./types";

/** What the card holds, read from the editor. */
export function cardHas(ed: EditorApi): CardHas {
  return {
    title: ed.draft.title, company: ed.draft.company, address: ed.draft.address, bio: ed.card.bio ?? "",
    photo: !!ed.card.photo_url, cover: !!ed.card.cover_url, buttons: ed.draft.items.length,
  };
}

interface Props {
  ed: EditorApi;
  design: Design;
  /** Jump to another step of the guided editor. */
  onGo: (step: GuidedKey) => void;
  /** Show the inputs for the missing details here (false: only the list). */
  inline?: boolean;
}

// Not the global .chip class: that one is a fixed 32px icon square.
const CHIP = { display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 999, border: "1px solid var(--line)", background: "var(--surface)", fontWeight: 600, fontSize: 13 } as const;

export function StyleNeeds({ ed, design, onGo, inline = true }: Props) {
  const { t, number } = useI18n();
  const needs = styleNeeds(design, cardHas(ed));
  const missing = needs.shows.filter((n) => n.missing);
  const label = (n: Need) => (n.key === "buttons" ? t("editor.needsButtons") : t(FIELD_LABELS[n.key]));
  const have = ed.draft.items.length;

  return (
    <section className="notice" role="status" aria-label={t("editor.needsHead")} data-needs style={{ display: "block" }}>
      <b>{t("editor.needsHead")}</b>
      <p className="hint" style={{ margin: "4px 0 8px" }}>{missing.length === 0 ? t("editor.needsAllSet") : t("editor.needsIntro")}</p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: 6 }}>
        {needs.shows.map((n) => (
          <li key={n.key} data-need={n.key} data-missing={n.missing ? "1" : "0"} style={CHIP}>
            <Icon name={n.missing ? "alert" : "check"} size="s" />
            {label(n)} <span className="hint">{n.missing ? t("editor.needsMissing") : t("editor.needsFilled")}</span>
          </li>
        ))}
      </ul>
      <p className="hint" style={{ margin: "8px 0 0" }}>
        {needs.slots === null
          ? null
          : needs.slots <= needs.wanted
            ? t("editor.needsButtonsFew", { n: number(needs.slots), have: number(have) })
            : t("editor.needsButtonsMany", { n: number(needs.slots), have: number(have), want: number(needs.wanted) })}
      </p>
      {needs.hidden.length > 0 && <p className="hint" style={{ margin: "4px 0 0" }}>{t("editor.notDrawn", { list: needs.hidden.map((k) => t(FIELD_LABELS[k])).join(", ") })}</p>}
      {needs.ownLayout && <p className="hint" style={{ margin: "4px 0 0" }}>{t("editor.needsOwnLayout")}</p>}
      {design.font !== "face" || design.size !== 100 ? <p className="hint" style={{ margin: "4px 0 0" }}>{t("editor.needsFontNote")}</p> : null}
      {inline && missing.length > 0 && (
        <div className="pane" style={{ gap: 8, marginBlockStart: 10 }}>
          {missing.map((n) => {
            if (n.key === "title" || n.key === "company" || n.key === "address") {
              return <GuardedField key={n.key} ed={ed} field={n.key} label={`${label(n)} (${t("editor.needsFieldHint")})`} multiline={n.key === "address"} />;
            }
            if (n.key === "bio") return <BioField key={n.key} ed={ed} />;
            if (n.key === "cover") return ed.canCover ? <CoverUpload key={n.key} ed={ed} /> : null;
            if (n.key === "photo") return <button key={n.key} type="button" className="btn ghost sm" onClick={() => onGo("details")}>{t("editor.needsFillIn")}: {label(n)}</button>;
            return <button key={n.key} type="button" className="btn ghost sm" onClick={() => onGo("buttons")}><Icon name="plus" size="s" />{t("editor.needsAddButtons")}</button>;
          })}
        </div>
      )}
      {!inline && missing.length > 0 && (
        <div className="row" style={{ marginBlockStart: 8 }}>
          {missing.some((n) => n.key === "buttons") && <button type="button" className="btn ghost sm" onClick={() => onGo("buttons")}>{t("editor.needsAddButtons")}</button>}
        </div>
      )}
    </section>
  );
}
