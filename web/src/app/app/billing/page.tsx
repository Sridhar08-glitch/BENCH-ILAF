"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/Icon";
import { Empty, ErrorBox, PageHead, SkeletonBlocks, UpgradeNotice, useToast } from "@/components/app/ui";
import { useWs } from "@/components/app/WorkspaceContext";
import { api, isUpgradeError } from "@/lib/api";
import { keys, useInvoices, usePlans } from "@/lib/hooks";
import { tk, type MessageKey } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import type { Plan } from "@/lib/types";

const PRICE_UNIT: Record<string, MessageKey> = {
  month: tk("billing.perMonth"), year: tk("billing.perYear"), "seat:month": tk("billing.perSeatMonth"), "seat:year": tk("billing.perSeatYear"),
};

export default function BillingPage() {
  return (
    <Suspense fallback={<SkeletonBlocks rows={3} />}>
      <Billing />
    </Suspense>
  );
}

function Billing() {
  const { current } = useWs();
  const { t, date: formatDate, money } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const plans = usePlans();
  const invoices = useInvoices(current.id);
  const paid = useSearchParams().get("paid");
  const sub = current.subscription;
  const [err, setErr] = useState<unknown>(null);
  const [seats, setSeats] = useState<Record<string, number>>({});
  const date = (d: string | null) => (d ? formatDate(d, { day: "numeric", month: "short", year: "numeric" }) : "-");

  // Back from the payment page: refresh the plan and tell the owner it worked.
  useEffect(() => {
    if (paid) {
      toast(t("billing.paidToast"));
      void qc.invalidateQueries({ queryKey: keys.workspaces });
      void qc.invalidateQueries({ queryKey: keys.invoices(current.id) });
    }
    // run once per return from checkout
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paid]);

  const checkout = useMutation({
    mutationFn: (v: { plan: Plan; seats?: number }) => api.checkout(current.id, v.plan.code, v.plan.per_seat ? v.seats : undefined),
    onSuccess: (r) => window.location.assign(r.checkout_url),
    onError: setErr,
  });

  const available = (plans.data ?? []).filter((p) => p.kind === current.kind);
  const active = plans.data?.find((p) => p.code === sub.plan_code);
  const ended = sub.status === "expired";

  return (
    <div className="view">
      <PageHead title={t("billing.title")} sub={t("billing.sub")} />

      {paid && (
        <div className="notice" role="status"><Icon name="check" /><div className="grow"><b>{t("billing.thanks")}</b>{t("billing.thanksText")}</div></div>
      )}
      {isUpgradeError(err) ? <UpgradeNotice error={err} /> : err ? <ErrorBox error={err} /> : null}

      <div className="g2" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)" }}>
        <div className="panel card">
          <div className="head">
            <h2><span className="chip ok"><Icon name="check" size="s" /></span>{t("billing.subscription")}</h2>
            <span className={`pill ${sub.live ? "ok" : ended ? "bad" : ""}`}>{sub.status === "none" ? t("billing.noPlan") : sub.live ? (ended ? t("billing.grace") : t("billing.active")) : t("billing.expired")}</span>
          </div>
          <div className="list">
            <div className="li"><div className="t"><small>{t("billing.plan")}</small><b dir="auto">{active?.name ?? t("billing.none")}</b></div></div>
            {sub.ends_at && <div className="li"><div className="t"><small>{ended ? t("billing.endedOn") : t("billing.renewsOn")}</small><b>{date(sub.ends_at)}</b></div></div>}
            {current.kind === "company" && <div className="li"><div className="t"><small>{t("billing.seats")}</small><b>{t("billing.seatsUsed", { used: sub.seats_used, total: sub.seats_total })}</b></div></div>}
          </div>
          {ended && sub.live && (
            <div className="notice warn" role="status"><Icon name="alert" /><div className="grow"><b>{t("billing.renewBefore", { date: date(sub.grace_ends_at) })}</b>{t("billing.renewBeforeText")}</div></div>
          )}
          {ended && !sub.live && (
            <div className="notice bad" role="status"><Icon name="alert" /><div className="grow"><b>{t("billing.offline")}</b>{t("billing.offlineText")}</div></div>
          )}
          <div className="hint">{t("billing.lateHint")}</div>
        </div>

        <div className="panel card">
          <div className="head"><h2><span className="chip"><Icon name="download" size="s" /></span>{t("billing.invoices")}</h2></div>
          {invoices.isLoading ? <SkeletonBlocks rows={2} /> : invoices.error ? <ErrorBox error={invoices.error} onRetry={() => void invoices.refetch()} /> : (invoices.data?.length ?? 0) === 0 ? (
            <Empty title={t("billing.noInvoices")}>{t("billing.noInvoicesText")}</Empty>
          ) : (
            <div className="list">
              {invoices.data?.map((i) => (
                <div className="li" key={i.id}>
                  <div className="t"><b className="ltr">{i.number}</b><small>{date(i.paid_at)} &middot; <span className="ltr">{i.plan_code}</span></small></div>
                  <b>{money(i.amount_minor, i.currency)}</b>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="sechead">{sub.live && !ended ? t("billing.changeOrExtend") : t("billing.choosePlan")}</div>
      {plans.isLoading ? <SkeletonBlocks rows={2} /> : plans.error ? <ErrorBox error={plans.error} onRetry={() => void plans.refetch()} /> : (
        <div className="plans">
          {available.map((p) => {
            const n = Math.max(p.min_seats, seats[p.code] ?? Math.max(p.min_seats, sub.seats_total || 0));
            const total = p.per_seat ? p.price_minor * n : p.price_minor;
            const isCurrent = sub.plan_code === p.code;
            const unit = PRICE_UNIT[`${p.per_seat ? "seat:" : ""}${p.interval}`];
            return (
              <div className={`plan ${isCurrent ? "current" : ""}`} key={p.code}>
                {isCurrent && <span className="pill dark" style={{ alignSelf: "flex-start" }}>{t("billing.currentPlan")}</span>}
                <h2 dir="auto">{p.name}</h2>
                <div className="price">{money(p.price_minor, p.currency)}<small> {unit ? t(unit) : `/ ${p.interval}`}</small></div>
                <ul>
                  <li><Icon name="check" size="s" />{p.per_seat ? t("billing.oneCardPerSeat") : t("billing.cardsEach", { n: p.max_cards })}</li>
                  {p.features.map((f) => <li key={f}><Icon name="check" size="s" />{f}</li>)}
                </ul>
                {p.per_seat && (
                  <label>
                    {t("billing.seatsMin", { min: p.min_seats })}
                    <input type="number" min={p.min_seats} max={5000} value={n} onChange={(e) => setSeats({ ...seats, [p.code]: Math.max(p.min_seats, parseInt(e.target.value || "0", 10) || p.min_seats) })} />
                  </label>
                )}
                <button type="button" className="btn" disabled={checkout.isPending} onClick={() => { setErr(null); checkout.mutate({ plan: p, seats: n }); }}>
                  {checkout.isPending ? t("billing.oneMoment") : isCurrent ? t("billing.extendFor", { price: money(total, p.currency) }) : t("billing.chooseFor", { price: money(total, p.currency) })}
                </button>
              </div>
            );
          })}
          {available.length === 0 && <div className="panel"><Empty title={t("billing.noPlans")}>{t("billing.noPlansText")}</Empty></div>}
        </div>
      )}
    </div>
  );
}
