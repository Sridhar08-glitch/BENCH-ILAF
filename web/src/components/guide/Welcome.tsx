"use client";

// The welcome dialog: up to three short screens (what do you want to do, your plan, you are set).
// Keyboard accessible, focus is trapped while it is open, and it never blocks: Skip is always there.
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { useWs } from "@/components/app/WorkspaceContext";
import { APP_NAME } from "@/lib/config";
import { useI18n } from "@/lib/i18n/client";
import { tk } from "@/lib/i18n";
import { WELCOME, inferAudience } from "@/lib/guide/engine";
import { GUIDES } from "@/lib/guide/guides";
import { AUDIENCES, type Audience } from "@/lib/guide/types";
import type { ProgressChange } from "@/lib/guide/api";
import { useSaveChanges } from "@/lib/guide/hooks";
import { useFocusTrap } from "./useFocusTrap";
import s from "./guide.module.css";

const OPTIONS: { audience: Audience; icon: string; title: ReturnType<typeof tk>; text: ReturnType<typeof tk> }[] = [
  { audience: "personal", icon: "card", title: tk("guide.welcome.optMine"), text: tk("guide.welcome.optMineText") },
  { audience: "company_owner", icon: "brand", title: tk("guide.welcome.optCompany"), text: tk("guide.welcome.optCompanyText") },
  { audience: "employee", icon: "adduser", title: tk("guide.welcome.optInvited"), text: tk("guide.welcome.optInvitedText") },
];

const ROLE_LINE: Partial<Record<Audience, ReturnType<typeof tk>>> = {
  company_owner: tk("guide.welcome.roleOwner"),
  company_admin: tk("guide.welcome.roleAdmin"),
  employee: tk("guide.welcome.roleEmployee"),
};

export function Welcome({ onClose }: { onClose: () => void }) {
  const { t, number } = useI18n();
  const { current, role, isManager } = useWs();
  const router = useRouter();
  const { save } = useSaveChanges();
  const ref = useRef<HTMLDivElement>(null);
  const inferred = inferAudience({ kind: current.kind, role });
  const ask = inferred === null;
  const screens = ask ? (["question", "plan", "done"] as const) : (["plan", "done"] as const);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<Audience | null>(null);
  const audience: Audience = inferred ?? picked ?? "personal";
  const screen = screens[index];

  function finish(open: boolean) {
    const changes: ProgressChange[] = [{ guide_id: WELCOME, step_id: "seen", state: "dismissed" }];
    if (ask && picked) for (const a of AUDIENCES) changes.push({ guide_id: WELCOME, step_id: `audience-${a}`, state: a === picked ? "done" : "reset" });
    save(changes);
    onClose();
    if (open) router.push(isManager ? "/app" : "/app/cards");
  }
  function skip() {
    // Skipping keeps a choice the person already made.
    save([{ guide_id: WELCOME, step_id: "seen", state: "dismissed" }]);
    onClose();
  }
  useFocusTrap(ref, skip, "[data-first]");

  const steps = GUIDES[audience].steps.filter((st) => !st.appliesWhen).slice(0, 5);
  const invited = ask && picked === "employee";
  const doneText = isManager ? t("guide.welcome.doneTextFirst") : t("guide.welcome.doneTextCards");

  return (
    <div className={s.veil}>
      <div className={s.dlg} role="dialog" aria-modal="true" aria-label={t("guide.welcome.dialogLabel")} ref={ref}>
        <div className={s.dlgtop}>
          <div className={s.dots} aria-hidden="true">
            {screens.map((_, i) => <i key={i} className={i === index ? s.on : ""} />)}
          </div>
          <span className="hint" aria-live="polite">{t("guide.welcome.stepOf", { n: number(index + 1), total: number(screens.length) })}</span>
          <button type="button" className={s.x} aria-label={t("guide.close")} onClick={skip}><Icon name="x2" size="s" /></button>
        </div>

        {screen === "question" && (
          <>
            <h2>{t("guide.welcome.title", { app: APP_NAME })}</h2>
            <p>{t("guide.welcome.questionText")}</p>
            <div role="radiogroup" aria-label={t("guide.welcome.question")} className={s.opts}>
              {OPTIONS.map((o, i) => (
                <button
                  key={o.audience}
                  type="button"
                  role="radio"
                  aria-checked={picked === o.audience}
                  className={s.opt}
                  data-first={i === 0 ? "" : undefined}
                  onClick={() => setPicked(o.audience)}
                >
                  <span className={s.ic}><Icon name={o.icon} /></span>
                  <span><b>{t(o.title)}</b><span className={s.t}>{t(o.text)}</span></span>
                </button>
              ))}
            </div>
          </>
        )}

        {screen === "plan" && (
          invited ? (
            <>
              <h2 data-first="">{t("guide.welcome.invitedTitle")}</h2>
              <p>{t("guide.welcome.invitedText")}</p>
            </>
          ) : (
            <>
              <h2 data-first="">{ask ? t("guide.welcome.planTitle") : t("guide.welcome.title", { app: APP_NAME })}</h2>
              <p>{inferred && ROLE_LINE[inferred] ? t(ROLE_LINE[inferred]!) : t("guide.welcome.planText")}</p>
              <ol className={s.plan}>
                {steps.map((st) => (
                  <li key={st.id}><span><b>{t(st.title)}</b><small>{t(st.text)}</small></span></li>
                ))}
              </ol>
            </>
          )
        )}

        {screen === "done" && (
          <>
            <h2 data-first="">{t("guide.welcome.doneTitle")}</h2>
            <p>{doneText}</p>
            <p>{t("guide.welcome.doneHint")}</p>
          </>
        )}

        <div className={s.foot}>
          <button type="button" className="btn ghost sm" onClick={skip}>{t("guide.welcome.skip")}</button>
          <span className={s.grow} style={{ flex: 1 }} />
          {index > 0 && <button type="button" className="btn ghost" onClick={() => setIndex(index - 1)}>{t("guide.welcome.back")}</button>}
          {screen === "done" ? (
            <button type="button" className="btn" onClick={() => finish(true)}>{t("guide.welcome.start")}</button>
          ) : (
            <button type="button" className="btn" disabled={screen === "question" && !picked} onClick={() => setIndex(index + 1)}>{t("guide.welcome.next")}</button>
          )}
        </div>
      </div>
    </div>
  );
}
