"use client";

// The "Getting started" checklist card: a progress ring, the steps with ticks that follow the real data,
// a button on every step that opens the exact page, collapse and hide, and an "all done" state with next suggestions.
import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { useWs } from "@/components/app/WorkspaceContext";
import { useI18n } from "@/lib/i18n/client";
import { CHECKLIST, allDoneSuggestions, chosenAudience, stateOf } from "@/lib/guide/engine";
import { NEW_COMPANY_EVENT } from "@/lib/guide/api";
import { useGuideState, useSaveChanges } from "@/lib/guide/hooks";
import type { ProgressState } from "@/lib/guide/types";
import s from "./guide.module.css";

const COLLAPSE_KEY = "bench.guide.collapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

export function GettingStarted() {
  const { t, number } = useI18n();
  const { workspaces, current } = useWs();
  const { loading, audience, ctx, view, progress } = useGuideState();
  const { save: saveChanges, failed } = useSaveChanges();
  const save = (guide: string, step: string, state: ProgressState | "reset") => saveChanges([{ guide_id: guide, step_id: step, state }]);
  const [collapsed, setCollapsed] = useState(false);
  const [justHidden, setJustHidden] = useState(false);
  useEffect(() => setCollapsed(readCollapsed()), []);

  if (loading) return null;
  const hidden = stateOf(progress, CHECKLIST, "hidden") === "dismissed";
  if (hidden) {
    return justHidden ? (
      <div className={`panel card ${s.hid}`} role="status">
        <span>{t("guide.card.hidden")}</span>
        <button type="button" className={s.link} onClick={() => { save(CHECKLIST, "hidden", "reset"); setJustHidden(false); }}>{t("guide.card.undo")}</button>
      </div>
    ) : null;
  }

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
  }

  const wantsCompany = chosenAudience(progress) === "company_owner" && current.kind === "personal" && !workspaces.some((w) => w.kind === "company");
  const r = 20;
  const circ = 2 * Math.PI * r;
  const sugs = view.complete ? allDoneSuggestions(ctx) : [];

  return (
    <section className="panel card" aria-labelledby="gs-title" data-guide="getting-started">
      <div className={s.gs}>
        <div className={s.gshead}>
          <div className={s.ring} role="img" aria-label={t("guide.card.ringLabel", { percent: number(view.percent) })}>
            <svg viewBox="0 0 48 48" aria-hidden="true">
              <circle className={s.bg} cx="24" cy="24" r={r} fill="none" strokeWidth="5" />
              <circle className={s.fg} cx="24" cy="24" r={r} fill="none" strokeWidth="5" strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - view.percent / 100)} />
            </svg>
            <b>{number(view.percent)}%</b>
          </div>
          <div className={s.tt}>
            <h2 id="gs-title">{t(view.guide.title)}</h2>
            <small>{view.complete ? t("guide.card.allDoneTitle") : t("guide.card.progress", { done: number(view.finished), total: number(view.total) })}</small>
          </div>
          <button type="button" className="btn ghost sm" aria-expanded={!collapsed} onClick={toggle} aria-label={collapsed ? t("guide.card.expand") : t("guide.card.collapse")}>
            <Icon name="chev" size="s" style={{ transform: collapsed ? undefined : "rotate(180deg)" }} />
          </button>
          <button type="button" className="btn ghost sm" onClick={() => { save(CHECKLIST, "hidden", "dismissed"); setJustHidden(true); }}>{t("guide.card.hide")}</button>
        </div>

        {!collapsed && (
          <>
            <div className={s.bar} aria-hidden="true"><i style={{ inlineSize: `${view.percent}%` }} /></div>

            {wantsCompany && (
              <div className={s.sug}>
                <div className={s.body}><b>{t("guide.card.companyFirstTitle")}</b><small>{t("guide.card.companyFirstText")}</small></div>
                <button type="button" className="btn sm" onClick={() => window.dispatchEvent(new CustomEvent(NEW_COMPANY_EVENT))}>{t("guide.card.companyFirstAction")}</button>
              </div>
            )}

            {view.complete && (
              <div className={s.party} role="status">
                <b>{t("guide.card.allDoneTitle")}</b>
                <span>{t("guide.card.allDoneText")}</span>
              </div>
            )}
            {sugs.length > 0 && (
              <div className={s.sugs} aria-label={t("guide.card.nextTitle")} role="group">
                {sugs.map((g) => (
                  <div className={s.sug} key={g.id}>
                    <div className={s.body}><b>{t(g.title)}</b><small>{t(g.text)}</small></div>
                    <Link className="btn sm" href={g.route}>{t(g.action)}</Link>
                  </div>
                ))}
              </div>
            )}

            {failed && <span className={s.err} role="alert">{t("guide.card.errorSaving")}</span>}
            <ol className={s.steps}>
              {view.steps.map((sv) => {
                const isNext = view.next?.step.id === sv.step.id;
                const manual = stateOf(progress, audience, sv.step.id);
                const status = sv.status === "done" ? t("guide.card.statusDone") : sv.status === "skipped" ? t("guide.card.statusSkipped") : t("guide.card.todo");
                return (
                  <li key={sv.step.id} className={`${s.step} ${sv.status === "done" ? s.done : sv.status === "skipped" ? s.skipped : ""} ${isNext ? s.isnext : ""}`}>
                    <span className={s.tick} aria-hidden="true">{sv.status !== "todo" && <Icon name="check" size="s" />}</span>
                    <div className={s.body}>
                      <b>{t(sv.step.title)} {sv.step.optional && <span className={s.tag}>{t("guide.card.optional")}</span>} {sv.status !== "todo" && <span className={s.tag}>{status}</span>}</b>
                      <small>{t(sv.step.text)}</small>
                    </div>
                    <div className={s.acts}>
                      {sv.status === "todo" && <Link className={isNext ? "btn sm" : "btn ghost sm"} href={sv.href}>{t(sv.step.action ?? "guide.open")}</Link>}
                      {sv.status === "todo" && <button type="button" className={s.link} onClick={() => save(audience, sv.step.id, "done")}>{t("guide.card.markDone")}</button>}
                      {sv.status === "todo" && <button type="button" className={s.link} onClick={() => save(audience, sv.step.id, "skipped")}>{t("guide.card.skip")}</button>}
                      {sv.status !== "todo" && manual && !sv.auto && <button type="button" className={s.link} onClick={() => save(audience, sv.step.id, "reset")}>{t("guide.card.undoStep")}</button>}
                    </div>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </div>
    </section>
  );
}
