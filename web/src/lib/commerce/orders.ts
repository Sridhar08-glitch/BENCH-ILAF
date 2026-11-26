// Orders and bookings as the owner sees them: the allowed next steps of each status, and the query the lists send.
import type { Order, OrderStatus, PaymentStatus, BookingRow, BookingStatus } from "../api-commerce";

export const ORDER_STATUSES: readonly OrderStatus[] = ["new", "confirmed", "ready", "delivered", "cancelled"];
export const PAYMENT_STATUSES: readonly PaymentStatus[] = ["unpaid", "paid", "refunded"];
export const BOOKING_STATUSES: readonly BookingStatus[] = ["requested", "confirmed", "done", "cancelled"];

/** A delivered or cancelled order keeps its status. */
export function orderIsFinal(status: OrderStatus): boolean {
  return status === "delivered" || status === "cancelled";
}

/** The statuses an order may be moved to from where it is. */
export function nextOrderStatuses(status: OrderStatus): OrderStatus[] {
  switch (status) {
    case "new": return ["confirmed", "cancelled"];
    case "confirmed": return ["ready", "cancelled"];
    case "ready": return ["delivered", "cancelled"];
    default: return [];
  }
}

/** requested -> confirmed | cancelled, confirmed -> done | cancelled; nothing else. */
export function nextBookingStatuses(status: BookingStatus): BookingStatus[] {
  switch (status) {
    case "requested": return ["confirmed", "cancelled"];
    case "confirmed": return ["done", "cancelled"];
    default: return [];
  }
}

export interface ListFilters {
  card: string;
  status: string;
  q: string;
  from: string;
  to: string;
}

export const NO_FILTERS: ListFilters = { card: "", status: "", q: "", from: "", to: "" };

export function filterCount(f: ListFilters): number {
  return [f.card, f.status, f.q.trim(), f.from, f.to].filter(Boolean).length;
}

/** "from" after "to" can match nothing: say so before asking. */
export function rangeProblem(f: Pick<ListFilters, "from" | "to">): boolean {
  return !!f.from && !!f.to && f.from > f.to;
}

/** The query string of a list call (page numbers start at 1). */
export function listQuery(f: ListFilters, page: number, pageSize: number, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams();
  if (f.card) p.set("card", f.card);
  if (f.status) p.set("status", f.status);
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  p.set("page", String(Math.max(1, page)));
  p.set("page_size", String(pageSize));
  return p.toString();
}

/** One line for an order's items: "2 x Coffee, 1 x Cake". */
export function itemsSummary(order: Pick<Order, "items">, max = 3): string {
  const parts = order.items.map((i) => `${i.qty} × ${i.title}`);
  return parts.length > max ? `${parts.slice(0, max).join(", ")} +${parts.length - max}` : parts.join(", ");
}

export function bookingWhen(b: Pick<BookingRow, "local_start" | "start_at">): string {
  return b.local_start || b.start_at;
}
