"use client";

// A gentle, dismissible suggestion for someone on a personal workspace: turn this into a team (a company).
// It opens the existing "new company" form with the card's company name filled in; after it the person lands on Billing to choose a plan.
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { useWs } from "@/components/app/WorkspaceContext";
import { NEW_COMPANY_EVENT } from "@/lib/guide/api";
import { useCards, usePlans } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n/client";
import { minCompanySeats, readSnooze, shouldShowTeamPrompt, suggestedCompanyName, writeSnooze } from "@/lib/team-prompt/prompt";

export function TeamPrompt() {
  const { user, workspaces, current } = useWs();
  const { t, number } = useI18n();
  const cards = useCards(current.id);
  const plans = usePlans();
  // The snooze and the clock are read after mount: the server knows neither this browser's storage nor its time.
  const [clock, setClock] = useState<{ now: number; snoozedUntil: number | null } | null>(null);
  useEffect(() => setClock({ now: Date.now(), snoozedUntil: readSnooze() }), []);
  if (!clock || current.kind !== "personal") return null;
  const list = (cards.data ?? []).map((c) => ({ status: c.status, company: c.company ?? "", leads: c.stats?.leads ?? null }));
  const show = shouldShowTeamPrompt({
    workspaceKind: current.kind,
    hasCompany: workspaces.some((w) => w.kind === "company"),
    email: user.email,
    cards: list,
    snoozedUntil: clock.snoozedUntil,
    now: clock.now,
  });
  if (!show) return null;
  const seats = minCompanySeats(plans.data);
  return (
    <section className="notice" aria-labelledby="team-prompt-h" data-testid="team-prompt">
      <Icon name="users" />
      <div className="grow">
        <b id="team-prompt-h">{t("dash.teamPromptTitle")}</b>
        {t("dash.teamPromptText")}
        {seats !== null && <> {t("dash.teamPromptSeats", { n: number(seats) })}</>}
        <div className="row" style={{ marginBlockStart: 8 }}>
          <button type="button" className="btn sm" onClick={() => window.dispatchEvent(new CustomEvent(NEW_COMPANY_EVENT, { detail: { name: suggestedCompanyName(list) } }))}>{t("dash.teamPromptAction")}</button>
          <button
            type="button"
            className="btn ghost sm"
            aria-label={t("dash.teamPromptDismissAria")}
            onClick={() => {
              const now = Date.now();
              writeSnooze(now);
              setClock({ now, snoozedUntil: readSnooze() ?? now });
            }}
          >
            {t("dash.teamPromptDismiss")}
          </button>
        </div>
      </div>
    </section>
  );
}
