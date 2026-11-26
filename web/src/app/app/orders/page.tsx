"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/Icon";
import { ErrorBox, PageHead, SkeletonBlocks, useToast } from "@/components/app/ui";
import { useWs } from "@/components/app/WorkspaceContext";
import { ListFiltersBar } from "@/components/commerce/ListFilters";
import { EmptyState } from "@/components/guide/EmptyState";
import { Dialog } from "@/components/ops/shared";
import { commerceApi, commerceKeys, type Order, type OrderStatus, type PaymentStatus } from "@/lib/api-commerce";
import { NO_FILTERS, ORDER_STATUSES, PAYMENT_STATUSES, filterCount, itemsSummary, listQuery, nextOrderStatuses, orderIsFinal, rangeProblem, type ListFilters } from "@/lib/commerce/orders";
import { useDebounced } from "@/lib/icons-client";
import { useCards } from "@/lib/hooks";
import { commerceCards } from "@/lib/card-order";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import { METHOD_NAME, ORDER_STATUS_NAME, PAYMENT_NAME } from "@/lib/commerce/names";

const PAGE = 50;
const COLS = "minmax(0,1.5fr) minmax(0,1.2fr) 110px 150px";

export default function OrdersPage() {
  const { current, isManager, isCompany, user } = useWs();
  const { t, number, date, money } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState<ListFilters>(NO_FILTERS);
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [cut, setCut] = useState(false);
  const dq = useDebounced(f.q.trim(), 300);
  const cards = useCards(current.id);

  const filters = useMemo(() => ({ ...f, q: dq }), [f, dq]);
  const bad = rangeProblem(f);
  const query = listQuery(filters, page, PAGE);
  const orders = useQuery({ queryKey: commerceKeys.orders(current.id, query), queryFn: () => commerceApi.orders(current.id, query), enabled: !bad, placeholderData: (p) => p });
  const rows = orders.data?.results ?? [];
  const total = orders.data?.count ?? 0;

  // A link from the bell or an e-mail may name one order: ?order=<id>
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("order");
    if (id) setOpenId(id);
  }, []);

  const update = useMutation({
    mutationFn: (v: { id: string; status?: OrderStatus; payment_status?: PaymentStatus }) => commerceApi.updateOrder(current.id, v.id, { status: v.status, payment_status: v.payment_status }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["orders", current.id] }),
    onError: (e) => toast(apiErrorText(e, t, "commerce.orderUpdateFailed")),
  });

  async function exportCsv() {
    setExporting(true);
    setCut(false);
    try {
      const r = await commerceApi.downloadOrdersCsv(current.id, listQuery(filters, 1, PAGE));
      if (r.truncated) setCut(true);
    } catch (e) {
      toast(apiErrorText(e, t, "commerce.exportFailed"));
    } finally {
      setExporting(false);
    }
  }

  function change(next: ListFilters) {
    setF(next);
    setPage(1);
  }

  const open = rows.find((o) => o.id === openId) ?? null;
  const filtered = filterCount(f) > 0;
  return (
    <div className="view">
      <PageHead title={t("commerce.ordersTitle")} sub={isManager && isCompany ? t("commerce.ordersSubCompany") : t("commerce.ordersSub")}>
        {isManager && <button type="button" className="btn ghost" disabled={exporting} onClick={() => void exportCsv()}><Icon name="download" size="s" />{t("commerce.exportCsv")}</button>}
      </PageHead>
      {cut && <div className="notice warn" role="status"><Icon name="alert" /><div className="grow">{t("commerce.exportCut")}</div></div>}

      <ListFiltersBar
        value={f}
        onChange={change}
        searchLabel={t("commerce.ordersSearch")}
        statuses={ORDER_STATUSES.map((s) => ({ id: s, name: t(ORDER_STATUS_NAME[s]) }))}
        cards={commerceCards(cards.data ?? [], user.id, isManager).map((c) => ({ id: c.id, name: c.is_company ? t("cards.companyCardPill") : c.name }))}
      />

      <div className="panel card">
        <div className="trow h" style={{ ["--cols" as string]: COLS }}>
          <span>{t("commerce.colOrder")}</span><span className="hide-sm">{t("commerce.colItems")}</span><span className="hide-sm">{t("commerce.colTotal")}</span><span>{t("commerce.filterStatus")}</span>
        </div>
        {orders.isLoading ? (
          <SkeletonBlocks rows={4} />
        ) : orders.error ? (
          <ErrorBox error={orders.error} onRetry={() => void orders.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title={filtered ? t("commerce.ordersNoMatch") : t("commerce.ordersEmpty")}>{filtered ? t("commerce.ordersNoMatchText") : t("commerce.ordersEmptyText")}</EmptyState>
        ) : (
          rows.map((o) => {
            const next = nextOrderStatuses(o.status);
            return (
              <div key={o.id} className="trow" style={{ ["--cols" as string]: COLS }}>
                <div style={{ minWidth: 0 }}>
                  <button type="button" className="linkbtn" style={{ background: "none", border: 0, padding: 0, font: "inherit", cursor: "pointer", textAlign: "start" }} onClick={() => setOpenId(o.id)} aria-label={t("commerce.openOrder", { number: o.number })}>
                    <b>{o.number}</b> · <span dir="auto">{o.customer_name}</span>
                  </button>
                  <div className="hint"><bdi>{o.card_name}</bdi> · {date(o.created_at, { day: "numeric", month: "short" })}{o.payment_status !== "unpaid" ? ` · ${t(PAYMENT_NAME[o.payment_status])}` : ""}</div>
                  <div className="only-sm hint" dir="auto">{itemsSummary(o)} · {money(Math.round(Number(o.total) * 100), o.currency)}</div>
                </div>
                <span className="hide-sm hint" dir="auto">{itemsSummary(o)}</span>
                <b className="hide-sm" style={{ fontVariantNumeric: "tabular-nums" }}>{money(Math.round(Number(o.total) * 100), o.currency)}</b>
                <select value={o.status} disabled={orderIsFinal(o.status) || update.isPending} onChange={(e) => update.mutate({ id: o.id, status: e.target.value as OrderStatus })} aria-label={t("commerce.statusFor", { number: o.number })}>
                  <option value={o.status}>{t(ORDER_STATUS_NAME[o.status])}</option>
                  {next.map((s) => <option key={s} value={s}>{t(ORDER_STATUS_NAME[s])}</option>)}
                </select>
              </div>
            );
          })
        )}
        {total > PAGE && (
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="hint">{t("contacts.pageRange", { from: number((page - 1) * PAGE + 1), to: number(Math.min(total, page * PAGE)), total: number(total) })}</span>
            <div className="row">
              <button type="button" className="btn ghost sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>{t("common.previous")}</button>
              <button type="button" className="btn ghost sm" disabled={page * PAGE >= total} onClick={() => setPage((p) => p + 1)}>{t("common.next")}</button>
            </div>
          </div>
        )}
      </div>

      {open && (
        <OrderDialog
          order={open}
          busy={update.isPending}
          onClose={() => setOpenId(null)}
          onStatus={(status) => update.mutate({ id: open.id, status })}
          onPayment={(payment_status) => update.mutate({ id: open.id, payment_status })}
        />
      )}
    </div>
  );
}

function OrderDialog({ order: o, busy, onClose, onStatus, onPayment }: { order: Order; busy: boolean; onClose: () => void; onStatus: (s: OrderStatus) => void; onPayment: (p: PaymentStatus) => void }) {
  const { t, dateTime, money } = useI18n();
  const minor = (v: string) => Math.round(Number(v) * 100);
  const digits = o.customer_phone.replace(/\D/g, "");
  return (
    <Dialog title={t("commerce.orderNumber", { number: o.number })} onClose={onClose} wide footer={<button type="button" className="btn" onClick={onClose}>{t("common.close")}</button>}>
      <div className="pane">
        <div className="hint">{t("commerce.orderPlaced", { card: o.card_name, when: dateTime(o.created_at) })}</div>
        <div>
          <b dir="auto">{o.customer_name}</b>
          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            <a className="ltr" href={`tel:${o.customer_phone}`}>{o.customer_phone}</a>
            {digits && <a href={`https://wa.me/${digits}`} target="_blank" rel="noopener noreferrer">{t("commerce.whatsappThem")}</a>}
            {o.customer_email && <a className="ltr" href={`mailto:${o.customer_email}`}>{o.customer_email}</a>}
          </div>
          {o.address && <div dir="auto" style={{ marginBlockStart: 6 }}>{o.address}</div>}
          {o.note && <div className="hint" dir="auto" style={{ marginBlockStart: 6 }}>{t("contacts.quoted", { text: o.note })}</div>}
        </div>
        <div>
          {o.items.map((i) => (
            <div key={i.product_id} className="row" style={{ justifyContent: "space-between", padding: "4px 0" }}>
              <span dir="auto">{i.qty} × {i.title}</span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{money(minor(i.unit_price) * i.qty, i.currency)}</span>
            </div>
          ))}
          <div className="row" style={{ justifyContent: "space-between", borderBlockStart: "1px solid var(--line-soft)", paddingBlockStart: 8, marginBlockStart: 4 }}>
            <b>{t("commerce.total")}</b><b style={{ fontVariantNumeric: "tabular-nums" }}>{money(minor(o.total), o.currency)}</b>
          </div>
          <div className="hint">{t("commerce.paidBy", { method: t(METHOD_NAME[o.payment_method]) })}</div>
        </div>
        <div className="two">
          <label>{t("commerce.filterStatus")}
            <select value={o.status} disabled={busy || orderIsFinal(o.status)} onChange={(e) => onStatus(e.target.value as OrderStatus)}>
              <option value={o.status}>{t(ORDER_STATUS_NAME[o.status])}</option>
              {nextOrderStatuses(o.status).map((s) => <option key={s} value={s}>{t(ORDER_STATUS_NAME[s])}</option>)}
            </select>
          </label>
          <label>{t("commerce.paymentStatus")}
            <select value={o.payment_status} disabled={busy} onChange={(e) => onPayment(e.target.value as PaymentStatus)}>
              {PAYMENT_STATUSES.map((p) => <option key={p} value={p}>{t(PAYMENT_NAME[p])}</option>)}
            </select>
          </label>
        </div>
      </div>
    </Dialog>
  );
}
