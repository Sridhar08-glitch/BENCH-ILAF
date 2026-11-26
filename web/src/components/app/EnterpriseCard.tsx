"use client";

// The Enterprise card of the billing page. Enterprise has no price list: the owner asks, our team sets the seats and the
// price for the company, and the owner accepts and pays (then it renews every year like the other plans).
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/Icon";
import { ErrorBox, useToast } from "@/components/app/ui";
import { useWs } from "@/components/app/WorkspaceContext";
import { api } from "@/lib/api";
import { keys, useEnterpriseRequest } from "@/lib/hooks";
import { useI18n } from "@/lib/i18n/client";
import type { Plan } from "@/lib/types";

export function EnterpriseCard({ plan, onError }: { plan: Plan; onError: (e: unknown) => void }) {
  const { current, role } = useWs();
  const { t, money } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const isOwner = role === "owner";
  const sub = current.subscription;
  const isCurrent = sub.plan_code === plan.code;
  const req = useEnterpriseRequest(current.id, isOwner);
  const request = req.data?.request ?? null;
  const open = request?.status === "requested" || request?.status === "quoted";
  const floor = Math.max(1, sub.seats_used);
  const [seats, setSeats] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [phone, setPhone] = useState("");
  const wanted = Math.max(floor, seats ?? Math.max(floor, plan.min_seats, isCurrent ? sub.seats_total : 5));
  const box = useRef<HTMLDivElement>(null);
  // Arriving from a locked screen ("Request a quote" link): bring the form into view once the card exists.
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash === "#enterprise") box.current?.scrollIntoView({ block: "center" });
  }, []);
  const refresh = () => qc.invalidateQueries({ queryKey: keys.enterprise(current.id) });

  const send = useMutation({
    mutationFn: () => api.requestEnterprise(current.id, { seats_wanted: wanted, message: message.trim() || undefined, phone: phone.trim() || undefined }),
    onSuccess: async () => { toast(t("billing.entSent")); setMessage(""); await refresh(); },
    onError,
  });
  const cancel = useMutation({
    mutationFn: () => api.cancelEnterprise(current.id),
    onSuccess: async () => { toast(t("billing.entCancelled")); await refresh(); },
    onError,
  });
  const accept = useMutation({
    mutationFn: () => api.acceptEnterprise(current.id),
    onSuccess: (r) => window.location.assign(r.checkout_url),
    onError,
  });

  return (
    <div ref={box} className={`plan ${isCurrent ? "current" : ""}`} id="enterprise" data-testid="enterprise-card">
      {isCurrent && <span className="pill dark" style={{ alignSelf: "flex-start" }}>{t("billing.currentPlan")}</span>}
      <h2 dir="auto">{plan.name}</h2>
      <div className="price"><span style={{ fontSize: "0.7em" }}>{t("billing.entPrice")}</span></div>
      <ul>
        {plan.features.map((f) => <li key={f}><Icon name="check" size="s" />{f}</li>)}
      </ul>
      <div className="hint">{t("billing.entPriceHint")}</div>
      {isCurrent && sub.live && <div className="hint">{t("billing.entStaffManaged")}</div>}

      {!isOwner ? (
        <div className="hint">{t("billing.entOwnerOnly")}</div>
      ) : req.isLoading ? null : req.error ? (
        <ErrorBox error={req.error} onRetry={() => void req.refetch()} />
      ) : request?.status === "requested" ? (
        <>
          <div className="notice" role="status"><Icon name="clock" /><div className="grow"><b>{t("billing.entRequested")}</b>{t("billing.entRequestedText", { seats: request.seats_wanted })}</div></div>
          <button type="button" className="btn ghost" disabled={cancel.isPending} onClick={() => cancel.mutate()}>{t("billing.entCancel")}</button>
        </>
      ) : request?.status === "quoted" && request.quoted_seats !== null && request.quoted_price_per_seat_minor !== null && request.quoted_total_minor !== null ? (
        <>
          <div className="notice ok" role="status" data-testid="enterprise-quote">
            <Icon name="check" />
            <div className="grow">
              <b>{t("billing.entQuoted")}</b>
              <div>{t("billing.entQuoteSeats", { n: request.quoted_seats })}</div>
              <div>{t("billing.entQuotePerSeat", { price: money(request.quoted_price_per_seat_minor, request.currency) })}</div>
              <div>{t("billing.entQuoteTotal", { price: money(request.quoted_total_minor, request.currency) })}</div>
              {request.staff_note && <div dir="auto">{t("billing.entNote", { note: request.staff_note })}</div>}
            </div>
          </div>
          <button type="button" className="btn" disabled={accept.isPending} onClick={() => accept.mutate()}>
            {accept.isPending ? t("billing.oneMoment") : t("billing.entAccept", { price: money(request.quoted_total_minor, request.currency) })}
          </button>
          <button type="button" className="btn ghost" disabled={cancel.isPending} onClick={() => cancel.mutate()}>{t("billing.entDecline")}</button>
        </>
      ) : (
        <>
          {request?.status === "declined" && (
            <div className="notice warn" role="status"><Icon name="alert" /><div className="grow"><b>{t("billing.entDeclined")}</b>{request.staff_note && t("billing.entNote", { note: request.staff_note })}</div></div>
          )}
          {isCurrent && <div className="hint">{t("billing.entAskAgain")}</div>}
          <label>
            {t("billing.entSeatsLabel", { min: floor })}
            <input type="number" min={floor} max={10000} value={wanted} onChange={(e) => setSeats(Math.max(floor, parseInt(e.target.value || "0", 10) || floor))} />
          </label>
          <label>
            {t("billing.entMessage")}
            <textarea rows={3} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} />
          </label>
          <label>
            {t("billing.entPhone")}
            <input type="tel" className="ltr" maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          <button type="button" className="btn" disabled={send.isPending || open} onClick={() => send.mutate()}>
            {send.isPending ? t("billing.oneMoment") : t("billing.entRequest")}
          </button>
        </>
      )}
    </div>
  );
}
