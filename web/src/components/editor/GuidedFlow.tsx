"use client";

// The step-by-step way to make a card: look, colour, details, buttons, layout under the card, extras, share.
// Every step reuses the full editor's own pieces (design picker, profile fields, buttons, content), so saving,
// company locks and approvals work exactly as they do there.
import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { WalletButton } from "@/components/app/WalletButton";
import { shortAddress } from "@/lib/card-address";
import { fieldsOf } from "@/lib/library/fieldsUsed";
import { normalizeDesign } from "@/lib/library";
import { allowedExtras } from "@/lib/ops/fields";
import { useI18n } from "@/lib/i18n/client";
import { useFlags } from "@/lib/flags";
import { belowForTop, introForTop } from "./design/logic";
import { ButtonsTab } from "./ButtonsTab";
import { ContentTab } from "./ContentTab";
import { DesignWizard } from "./design/DesignWizard";
import { ProfileTab } from "./ProfileTab";
import { DESIGN_STEPS, GUIDED_LABELS, TOUR_NAMES, guidedSteps, nextOf, prevOf, type GuidedKey } from "./guided";
import type { EditorApi } from "./types";

interface Props {
  ed: EditorApi;
  /** The Extras step follows the page-styles switch. */
  extras: boolean;
  live: boolean;
  busy: boolean;
  onPublish: () => void;
}

export function GuidedFlow({ ed, extras, live, busy, onPublish }: Props) {
  const { t, number } = useI18n();
  const design = normalizeDesign(ed.draft.design);
  // The Extras step is only there when the company lets this person add at least one extra (or they already have some).
  const mayAdd = allowedExtras(ed.access).length > 0;
  const steps = guidedSteps({ locked: ed.locked, extras: extras && mayAdd, header: design.top > 0 });
  const [step, setStep] = useState<GuidedKey>(steps[0]);
  const at = steps.includes(step) ? step : steps[0];
  const fields = fieldsOf(design);
  const go = (k: GuidedKey) => setStep(k);
  const next = () => go(nextOf(steps, at));
  const back = () => go(prevOf(steps, at));
  const pageStyles = (useFlags(ed.card.workspace_id) as Record<string, boolean>).page_styles ?? true;
  // Look: a card face (500 designs), or a page style (a header with its own look). Choosing a page style hides the face list for
  // most headers, so the owner picks the kind first and can always come back to the faces.
  const kind: "face" | "page" = design.top === 0 ? "face" : "page";
  const setKind = (k: "face" | "page") => {
    if (k === kind) return;
    const top = k === "face" ? 0 : 1;
    ed.update({ design: { ...design, top, below: belowForTop(top, design.below), intro: introForTop(top, design.intro) } });
  };
  const only = at === "look" ? (pageStyles && kind === "page" ? (["top", "face"] as const) : (["face"] as const)) : DESIGN_STEPS[at];

  const nav = (
    <div className="row" style={{ justifyContent: "space-between", marginBlockStart: 14 }}>
      <button type="button" className="btn ghost" disabled={at === steps[0]} onClick={back}>{t("common.back")}</button>
      {at !== steps[steps.length - 1] && <button type="button" className="btn" onClick={next}>{t("common.next")}</button>}
    </div>
  );

  return (
    <div className="pane">
      <ol className="gsteps" data-guide="editor-tabs" aria-label={t("editor.gsStepsAria")} style={{ display: "flex", gap: 6, flexWrap: "wrap", listStyle: "none", margin: 0, padding: 0 }}>
        {steps.map((k, i) => (
          <li key={k}>
            <button type="button" className={k === at ? "btn sm" : "btn ghost sm"} aria-current={k === at ? "step" : undefined} data-guide={`editor-tab-${TOUR_NAMES[k]}`} onClick={() => go(k)}>
              {number(i + 1)}. {t(GUIDED_LABELS[k])}
            </button>
          </li>
        ))}
      </ol>

      {ed.locked && (
        <div className="notice" role="status">
          <Icon name="lock" />
          <div className="grow">{t("editor.gsLocked")}</div>
        </div>
      )}
      {at === "look" && pageStyles && (
        <div className="row" role="group" aria-label={t("editor.gsLookKind")}>
          <button type="button" className={kind === "face" ? "btn sm" : "btn ghost sm"} aria-pressed={kind === "face"} onClick={() => setKind("face")}>{t("editor.gsLookFace")}</button>
          <button type="button" className={kind === "page" ? "btn sm" : "btn ghost sm"} aria-pressed={kind === "page"} onClick={() => setKind("page")}>{t("editor.gsLookPage")}</button>
        </div>
      )}
      <div data-guide="editor-body">
      {only ? (
        <DesignWizard key={`${at}-${kind}`} ed={ed} only={only} onFinish={next} onBack={at === steps[0] ? undefined : back} />
      ) : at === "details" ? (
        <div className="pane">
          <h3>{t("editor.gsDetailsTitle")}</h3>
          <p className="hint">{t("editor.gsDetailsText")}</p>
          <ProfileTab ed={ed} guided={fields} />
          {nav}
        </div>
      ) : at === "buttons" ? (
        <div className="pane">
          <h3>{t("editor.gsButtonsTitle")}</h3>
          <p className="hint">{t("editor.gsButtonsText")}</p>
          <ButtonsTab ed={ed} />
          {nav}
        </div>
      ) : at === "settings" ? (
        <div className="pane">
          <h3>{t("editor.gsSettingsTitle")}</h3>
          <p className="hint">{t("editor.gsSettingsText")}</p>
          <ProfileTab ed={ed} rest />
          {nav}
        </div>
      ) : at === "extras" ? (
        <div className="pane">
          <h3>{t("editor.gsExtrasTitle")}</h3>
          <p className="hint">{t("editor.gsExtrasText")}</p>
          {!fields.bio && ed.card.bio ? <div className="notice warn" role="status"><Icon name="alert" /><div className="grow">{t("editor.gsBioNote")}</div></div> : null}
          <ContentTab ed={ed} />
          {nav}
        </div>
      ) : (
        <div className="pane">
          <h3>{t("editor.gsShareTitle")}</h3>
          <p className="hint">{t("editor.gsShareText")}</p>
          <p role="status"><b>{live ? t("editor.gsLive") : t("editor.gsDraft")}</b></p>
          <div className="row">
            <button type="button" className={live ? "btn ghost" : "btn"} disabled={busy} onClick={onPublish}><Icon name="check" size="s" />{live ? t("editor.unpublish") : t("editor.publish")}</button>
            <Link className="btn ghost" href={`/app/share?card=${ed.card.id}`}><Icon name="qr" size="s" />{t("editor.qrShare")}</Link>
            <WalletButton cardId={ed.card.id} published={live} />
          </div>
          <p className="hint ltr">{shortAddress(ed.card)}</p>
          {nav}
        </div>
      )}
      </div>
    </div>
  );
}
