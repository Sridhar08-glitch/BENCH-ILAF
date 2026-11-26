"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { GettingStarted } from "@/components/guide/GettingStarted";
import { TeamPrompt } from "@/components/app/TeamPrompt";
import { announce } from "@/lib/guide/api";
import { Bars, COLORS, LineChart, Spark, delta } from "@/components/app/charts";
import { Empty, ErrorBox, PageHead, QrPreview, SkeletonBlocks } from "@/components/app/ui";
import { useWs } from "@/components/app/WorkspaceContext";
import { useAnalytics, useCards, useLeads, usePlans } from "@/lib/hooks";
import { platformName } from "@/lib/card/catalogue";
import { shortAddress } from "@/lib/card-address";
import { useI18n } from "@/lib/i18n/client";

export default function OverviewPage() {
  const { user, current } = useWs();
  const { t, number, date } = useI18n();
  const [days, setDays] = useState(30);
  const analytics = useAnalytics(current.id, days);
  const cards = useCards(current.id);
  const leads = useLeads(current.id, { limit: 5 });
  const plans = usePlans();
  const a = analytics.data;
  const sub = current.subscription;
  const plan = plans.data?.find((p) => p.code === sub.plan_code);
  const first = user.full_name.split(" ")[0];
  // The very first contact is worth a nudge; the guide shows it once.
  const leadCount = leads.data?.count;
  useEffect(() => {
    if (leadCount === 1) announce("first_lead");
  }, [leadCount]);

  const kpis = a
    ? [
        { t: t("dash.kpiViews"), n: a.totals.views, p: a.prev_totals.views, icon: "eye", series: a.series.map((s) => s.views) },
        { t: t("dash.kpiSaves"), n: a.totals.saves, p: a.prev_totals.saves, icon: "adduser", series: a.series.map((s) => s.saves) },
        { t: t("dash.kpiTaps"), n: a.totals.link_clicks, p: a.prev_totals.link_clicks, icon: "tap", series: [] as number[] },
        { t: t("dash.kpiScans"), n: a.totals.scans, p: a.prev_totals.scans, icon: "scan", series: [] as number[] },
      ]
    : [];
  const cardsTotal = plan ? (plan.per_seat ? sub.seats_total : plan.max_cards) : 0;

  return (
    <div className="view">
      <PageHead
        title={t("dash.hello", { name: first })}
        sub={a ? t("dash.heroViews", { views: a.totals.views, period: t("analytics.rangeDays", { days }) }) : t("dash.heroDefault")}
      >
        <Link className="btn ghost" href="/app/share"><Icon name="share" size="s" />{t("common.share")}</Link>
        <Link className="btn" href="/app/cards"><Icon name="card" size="s" />{t("dash.editCards")}</Link>
      </PageHead>

      <GettingStarted />
      <TeamPrompt />

      {analytics.isLoading ? (
        <SkeletonBlocks rows={2} />
      ) : analytics.error ? (
        <ErrorBox error={analytics.error} onRetry={() => void analytics.refetch()} />
      ) : (
        <div className="kpis">
          {kpis.map((k, i) => {
            const d = delta(k.n, k.p, { t, number });
            return (
              <div className="panel kpi" key={k.t}>
                <div className="t"><span>{k.t}</span><span className="chip"><Icon name={k.icon} size="s" /></span></div>
                <b>{number(k.n)}</b>
                <span className={`d ${d.up ? "up" : "dn"}`}>{d.up ? "▲" : "▼"} {t("dash.vsPrevious", { change: d.text })}</span>
                {k.series.length > 1 ? <Spark data={k.series.slice(-12)} color={[COLORS.orange, COLORS.blue, COLORS.green, COLORS.orange][i]} /> : <div style={{ height: 30 }} />}
              </div>
            );
          })}
        </div>
      )}

      <div className="g2">
        <div className="panel card">
          <div className="head">
            <h2><span className="chip"><Icon name="chart" size="s" /></span>{t("dash.kpiViews")}</h2>
            <div className="seg" role="group" aria-label={t("analytics.timeRange")}>
              {[7, 30, 90].map((d) => (
                <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}>{t("analytics.rangeDays", { days: d })}</button>
              ))}
            </div>
          </div>
          {a && a.series.length > 0 ? (
            <LineChart
              label={t("dash.viewsPerDay")}
              dates={a.series.map((s) => s.date)}
              series={[
                { key: "views", label: t("dash.seriesViews"), color: COLORS.orange, values: a.series.map((s) => s.views) },
                { key: "saves", label: t("dash.seriesSaves"), color: COLORS.blue, values: a.series.map((s) => s.saves) },
                { key: "leads", label: t("dash.seriesContacts"), color: COLORS.green, values: a.series.map((s) => s.leads) },
              ]}
            />
          ) : (
            <Empty title={t("dash.noViews")}>{t("dash.noViewsText")}</Empty>
          )}
        </div>

        <div className="panel card">
          <div className="head"><h2><span className="chip ok"><Icon name="qr" size="s" /></span>{t("dash.yourCards")}</h2></div>
          {cards.isLoading ? (
            <SkeletonBlocks rows={2} />
          ) : cards.error ? (
            <ErrorBox error={cards.error} onRetry={() => void cards.refetch()} />
          ) : cards.data && cards.data.length > 0 ? (
            <div className="list">
              {cards.data.slice(0, 5).map((c) => (
                <div className="li" key={c.id}>
                  <span className="mq"><QrPreview text={c.public_url} label={t("dash.uiQrFor", { text: c.name })} /></span>
                  <div className="t">
                    <b dir="auto">{c.name || t("cards.untitled")}{c.is_company && <span className="pill dark" style={{ marginInlineStart: 8 }}>{t("cards.companyCardPill")}</span>}</b>
                    <small><span className="ltr">{shortAddress(c)}</span> &middot; {t("dash.viewsCount", { n: c.stats.views })}</small>
                  </div>
                  <Link className="btn ghost sm" href={`/app/share?card=${c.id}`}>QR</Link>
                </div>
              ))}
            </div>
          ) : (
            <Empty title={t("dash.noCards")} action={<Link className="btn sm" href="/app/cards">{t("dash.createFirst")}</Link>} />
          )}
        </div>
      </div>

      <div className="g3">
        <div className="panel card">
          <div className="head"><h2><span className="chip"><Icon name="tap" size="s" /></span>{t("dash.mostTapped")}</h2></div>
          <Bars
            rows={(a?.top_buttons ?? []).slice(0, 5).map((b) => ({ label: platformName(b.kind, t), value: b.count }))}
            empty={t("dash.noTaps")}
          />
        </div>
        <div className="panel card">
          <div className="head">
            <h2><span className="chip"><Icon name="adduser" size="s" /></span>{t("dash.newContacts")}</h2>
            <Link className="btn ghost sm" href="/app/contacts">{t("common.all")}</Link>
          </div>
          {leads.isLoading ? (
            <SkeletonBlocks rows={2} />
          ) : leads.data && leads.data.results.length > 0 ? (
            <div className="list">
              {leads.data.results.map((l) => (
                <div className="li" key={l.id}>
                  <span className="ini">{l.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}</span>
                  <div className="t"><b dir="auto">{l.name}</b><small dir="auto">{l.company || l.email || l.phone}</small></div>
                </div>
              ))}
            </div>
          ) : (
            <Empty title={t("dash.noContacts")}>{t("dash.noContactsText")}</Empty>
          )}
        </div>
        <div className="panel card">
          <div className="head">
            <h2><span className="chip accent"><Icon name="crown" size="s" /></span>{t("dash.plan")}</h2>
            <span className={`pill ${sub.live ? "accent" : "warn"}`}>{plan?.name ?? (sub.status === "none" ? t("dash.noPlan") : sub.plan_code ?? t("dash.planNone"))}</span>
          </div>
          {plan && (
            <div className="usage">
              <div className="l"><span>{t("dash.cardsUsed")}</span><b>{t("dash.usedOf", { used: number(current.card_count), total: number(cardsTotal) })}</b></div>
              <div className="t"><i style={{ width: `${Math.min(100, (current.card_count / Math.max(1, cardsTotal)) * 100)}%` }} /></div>
            </div>
          )}
          {sub.ends_at && (
            <div className="usage">
              <div className="l"><span>{sub.status === "expired" ? t("dash.endedOn") : t("dash.renewsOn")}</span><b>{date(sub.ends_at, { day: "numeric", month: "short", year: "numeric" })}</b></div>
            </div>
          )}
          <Link className="btn ghost" href="/app/billing">{t("dash.managePlan")}</Link>
        </div>
      </div>
    </div>
  );
}
