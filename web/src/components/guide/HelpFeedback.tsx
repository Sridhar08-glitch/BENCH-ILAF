"use client";

// "Was this helpful?" thumbs and the Contact support link. The answer is saved as guide progress (help/<slug> up or down).
import Link from "next/link";
import { useI18n } from "@/lib/i18n/client";
import { HELP, stateOf } from "@/lib/guide/engine";
import { useGuideProgress, useSaveChanges } from "@/lib/guide/hooks";
import { SUPPORT_ROUTE, SUPPORT_ROUTE_READY } from "@/lib/help/config";
import s from "./guide.module.css";

export function HelpFeedback({ slug }: { slug: string }) {
  const { t } = useI18n();
  const { data } = useGuideProgress();
  const { save, failed } = useSaveChanges();
  const answer = data ? stateOf(data, HELP, slug) : null;
  const rated = answer === "up" || answer === "down";

  return (
    <div className={s.rate}>
      <b className={s.grow}>{rated ? (answer === "up" ? t("help.thanks") : t("help.thanksNo")) : t("help.helpfulQuestion")}</b>
      {!rated && (
        <>
          <button type="button" className="btn ghost sm" onClick={() => save([{ guide_id: HELP, step_id: slug, state: "up" }])}>{t("help.yes")}</button>
          <button type="button" className="btn ghost sm" onClick={() => save([{ guide_id: HELP, step_id: slug, state: "down" }])}>{t("help.no")}</button>
        </>
      )}
      {rated && <button type="button" className={s.link} onClick={() => save([{ guide_id: HELP, step_id: slug, state: "reset" }])}>{t("help.changeAnswer")}</button>}
      {failed && <span className={s.err} role="alert">{t("help.feedbackFailed")}</span>}
      <span style={{ flexBasis: "100%", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ color: "var(--mute)" }}>{t("help.stuck")}</span>
        {SUPPORT_ROUTE_READY ? (
          <Link className="btn sm" href={SUPPORT_ROUTE}>{t("help.contact")}</Link>
        ) : (
          <span className={s.soon} role="note"><span className="btn sm ghost" aria-disabled="true" style={{ opacity: 0.6, cursor: "not-allowed" }}>{t("help.contact")}</span>{t("help.comingSoon")}</span>
        )}
      </span>
    </div>
  );
}
