"use client";

// Where is my order? The buyer proves it is theirs with the phone number they gave when ordering.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import c from "../../c/[code]/Commerce.module.css";
import { phoneOk } from "../../c/[code]/CommerceShell";
import { publicCommerce, type OrderStatus, type OrderStatusView } from "@/lib/api-commerce";
import { ApiError } from "@/lib/api";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import { ORDER_STATUS_NAME as STATUS_NAME, PAYMENT_NAME as PAY_NAME } from "@/lib/commerce/names";

const STEPS: OrderStatus[] = ["new", "confirmed", "ready", "delivered"];
export function OrderLookup({ number, initialPhone }: { number: string; initialPhone: string }) {
  const { t, money, date } = useI18n();
  const [phone, setPhone] = useState(initialPhone);
  const [order, setOrder] = useState<OrderStatusView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const look = useCallback(
    async (p: string) => {
      setBusy(true);
      setError("");
      try {
        setOrder(await publicCommerce.orderStatus(number, p.trim()));
      } catch (e) {
        setOrder(null);
        setError(e instanceof ApiError && e.status === 404 ? t("commerce.statusNotFound") : apiErrorText(e, t, "commerce.statusFailed"));
      } finally {
        setBusy(false);
      }
    },
    [number, t],
  );

  // A link from the thank-you screen carries the phone: show the order straight away.
  useEffect(() => {
    if (phoneOk(initialPhone)) void look(initialPhone);
  }, [initialPhone, look]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!phoneOk(phone)) return setError(t("commerce.errPhone"));
    void look(phone);
  }

  const at = order ? STEPS.indexOf(order.status) : -1;
  return (
    <main className={c.page}>
      <div className={c.card}>
        <h1>{t("commerce.orderNumber", { number })}</h1>
        {!order && (
          <form onSubmit={submit} noValidate style={{ display: "contents" }}>
            <p>{t("commerce.statusLead")}</p>
            <label>
              <span>{t("commerce.phoneLabel")}</span>
              <input className="ltr" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
            </label>
            {error && <p className={c.error} role="alert">{error}</p>}
            <button type="submit" className="btn" disabled={busy}>{busy ? t("commerce.sending") : t("commerce.statusLookup")}</button>
          </form>
        )}
        {order && (
          <>
            <p>{t("commerce.statusFrom", { name: order.card_name, date: date(order.created_at) })}</p>
            <span className={c.badge} data-tone={order.status === "cancelled" ? "bad" : order.status === "delivered" ? "good" : undefined}>{t(STATUS_NAME[order.status])}</span>
            {order.status !== "cancelled" && (
              <ol className={c.steps} aria-label={t("commerce.statusSteps")}>
                {STEPS.map((s, i) => (
                  <li key={s} data-done={i < at} data-now={i === at} aria-current={i === at ? "step" : undefined}>{t(STATUS_NAME[s])}</li>
                ))}
              </ol>
            )}
            <ul className={c.lines}>
              {order.items.map((i) => (
                <li key={i.product_id} className={c.line} style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
                  <span className={c.lineName}><b dir="auto">{i.title}</b><small>{i.qty} × {money(Math.round(Number(i.unit_price) * 100), i.currency)}</small></span>
                </li>
              ))}
            </ul>
            <div className={c.sum}><span>{t("commerce.total")}</span><b>{money(Math.round(Number(order.total) * 100), order.currency)}</b></div>
            <p>{t("commerce.statusPayment", { status: t(PAY_NAME[order.payment_status] ?? PAY_NAME.unpaid) })}</p>
            {order.pay_url && order.payment_status === "unpaid" && <a className="btn" href={order.pay_url} rel="noopener noreferrer">{t("commerce.payNow")}</a>}
          </>
        )}
      </div>
    </main>
  );
}
