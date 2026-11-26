"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ErrorBox, PageHead, SkeletonBlocks, useToast } from "@/components/app/ui";
import { useWs } from "@/components/app/WorkspaceContext";
import { ListFiltersBar } from "@/components/commerce/ListFilters";
import { EmptyState } from "@/components/guide/EmptyState";
import { commerceApi, commerceKeys, type BookingRow, type BookingStatus } from "@/lib/api-commerce";
import { BOOKING_STATUS_NAME } from "@/lib/commerce/names";
import { BOOKING_STATUSES, NO_FILTERS, bookingWhen, filterCount, listQuery, nextBookingStatuses, rangeProblem, type ListFilters } from "@/lib/commerce/orders";
import { useDebounced } from "@/lib/icons-client";
import { useCards } from "@/lib/hooks";
import { commerceCards } from "@/lib/card-order";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";

const PAGE = 50;
const COLS = "minmax(0,1.3fr) minmax(0,1.4fr) 150px";

type Next = "confirmed" | "cancelled" | "done";

export default function BookingsPage() {
  const { current, isManager, isCompany, user } = useWs();
  const { t, number } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState<ListFilters>(NO_FILTERS);
  const [page, setPage] = useState(1);
  const dq = useDebounced(f.q.trim(), 300);
  const cards = useCards(current.id);

  const filters = useMemo(() => ({ ...f, q: dq }), [f, dq]);
  const bad = rangeProblem(f);
  // The bookings call has no free-text search: the box narrows the page already on screen.
  const query = listQuery({ ...filters, q: "" }, page, PAGE);
  const bookings = useQuery({ queryKey: commerceKeys.bookings(current.id, query), queryFn: () => commerceApi.bookings(current.id, query), enabled: !bad, placeholderData: (p) => p });
  const all = bookings.data?.results ?? [];
  const needle = dq.toLowerCase();
  const rows = needle ? all.filter((b) => [b.name, b.email, b.phone, b.note].some((v) => v.toLowerCase().includes(needle))) : all;
  const total = bookings.data?.count ?? 0;

  const update = useMutation({
    mutationFn: (v: { id: string; status: Next }) => commerceApi.updateBooking(current.id, v.id, v.status),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["bookings", current.id] }),
    onError: (e) => toast(apiErrorText(e, t, "commerce.bookingUpdateFailed")),
  });

  function change(next: ListFilters) {
    setF(next);
    setPage(1);
  }

  const filtered = filterCount(f) > 0;
  return (
    <div className="view">
      <PageHead title={t("commerce.bookingsTitle")} sub={isManager && isCompany ? t("commerce.bookingsSubCompany") : t("commerce.bookingsSub")} />
      <ListFiltersBar
        value={f}
        onChange={change}
        searchLabel={t("commerce.bookingsSearch")}
        statuses={BOOKING_STATUSES.map((s) => ({ id: s, name: t(BOOKING_STATUS_NAME[s]) }))}
        cards={commerceCards(cards.data ?? [], user.id, isManager).map((c) => ({ id: c.id, name: c.is_company ? t("cards.companyCardPill") : c.name }))}
      />

      <div className="panel card">
        <div className="trow h" style={{ ["--cols" as string]: COLS }}>
          <span>{t("commerce.colWhen")}</span><span className="hide-sm">{t("commerce.colGuest")}</span><span>{t("commerce.filterStatus")}</span>
        </div>
        {bookings.isLoading ? (
          <SkeletonBlocks rows={4} />
        ) : bookings.error ? (
          <ErrorBox error={bookings.error} onRetry={() => void bookings.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title={filtered || needle ? t("commerce.bookingsNoMatch") : t("commerce.bookingsEmpty")}>{filtered || needle ? t("commerce.bookingsNoMatchText") : t("commerce.bookingsEmptyText")}</EmptyState>
        ) : (
          rows.map((b) => <BookingLine key={b.id} b={b} busy={update.isPending} onStatus={(status) => update.mutate({ id: b.id, status })} />)
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
    </div>
  );
}

function BookingLine({ b, busy, onStatus }: { b: BookingRow; busy: boolean; onStatus: (s: Next) => void }) {
  const { t } = useI18n();
  const next = nextBookingStatuses(b.status) as Next[];
  const digits = b.phone.replace(/\D/g, "");
  return (
    <div className="trow" style={{ ["--cols" as string]: COLS }}>
      <div style={{ minWidth: 0 }}>
        <b className="ltr" style={{ unicodeBidi: "plaintext" }}>{bookingWhen(b)}</b>
        <div className="hint"><bdi>{b.card_name}</bdi></div>
        <div className="only-sm hint" dir="auto">{[b.name, b.email, b.phone].filter(Boolean).join(" · ")}</div>
      </div>
      <div className="hide-sm" style={{ minWidth: 0 }}>
        <b dir="auto">{b.name}</b>
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <a className="ltr" href={`mailto:${b.email}`}>{b.email}</a>
          {b.phone && <a className="ltr" href={`tel:${b.phone}`}>{b.phone}</a>}
          {digits && <a href={`https://wa.me/${digits}`} target="_blank" rel="noopener noreferrer">{t("commerce.whatsappThem")}</a>}
        </div>
        {b.note && <div className="hint" dir="auto">{t("contacts.quoted", { text: b.note })}</div>}
      </div>
      <select value={b.status} disabled={busy || next.length === 0} onChange={(e) => onStatus(e.target.value as Next)} aria-label={t("commerce.bookingStatusFor", { name: b.name })}>
        <option value={b.status}>{t(BOOKING_STATUS_NAME[b.status as BookingStatus])}</option>
        {next.map((s) => <option key={s} value={s}>{t(BOOKING_STATUS_NAME[s])}</option>)}
      </select>
    </div>
  );
}
