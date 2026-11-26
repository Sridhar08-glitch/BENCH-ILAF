// Products, orders and bookings. The owner's calls go through this app's /api/proxy like the main client (lib/api.ts);
// the visitor's calls go straight to the public API without cookies, like the contact form (lib/public-api.ts).
import { ApiError, errorFromResponse, waitingError } from "./api";
import { API_PUBLIC_URL } from "./config";
import { runtimeT } from "./i18n";
import type { AvailabilityDay, BookingSettings } from "./commerce/booking";
import type { EventSource } from "./types";

export type { BookingSettings } from "./commerce/booking";

// ---------------------------------------------------------------- shapes

export interface Product {
  id: string;
  section_id: string | null;
  title: string;
  description: string;
  price: string;
  currency: string;
  image_url: string | null;
  badge: string;
  meta: Record<string, unknown>;
  on: boolean;
  order: number;
  stock: number | null;
  created_at?: string;
  updated_at?: string;
}

export type ProductInput = Partial<Pick<Product, "title" | "description" | "price" | "currency" | "badge" | "meta" | "on" | "order" | "stock" | "section_id">> & { image?: null };

export type OrderStatus = "new" | "confirmed" | "ready" | "delivered" | "cancelled";
export type PaymentStatus = "unpaid" | "paid" | "refunded";
export type PaymentMethod = "cod" | "whatsapp" | "card_later";
export type BookingStatus = "requested" | "confirmed" | "done" | "cancelled";

export interface OrderLine {
  product_id: string;
  title: string;
  unit_price: string;
  currency: string;
  qty: number;
}

export interface Order {
  id: string;
  number: string;
  card_id: string | null;
  card_name: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  note: string;
  address: string;
  items: OrderLine[];
  subtotal: string;
  total: string;
  currency: string;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  pay_url: string | null;
  status: OrderStatus;
  consented_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BookingRow {
  id: string;
  card_id: string | null;
  card_name: string;
  start_at: string;
  end_at: string;
  local_start: string;
  timezone: string;
  name: string;
  email: string;
  phone: string;
  note: string;
  status: BookingStatus;
  consented_at: string | null;
  created_at: string;
}

export interface Page<T> {
  count: number;
  page: number;
  pages: number;
  page_size: number;
  results: T[];
}

// ---------------------------------------------------------------- the owner's calls

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

async function fail(res: Response): Promise<never> {
  let json: Parameters<typeof errorFromResponse>[1] = null;
  try {
    json = (await res.json()) as typeof json;
  } catch {
    /* not JSON */
  }
  throw errorFromResponse(res, json);
}

async function call<T>(method: Method, path: string, body?: unknown, form?: FormData): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin" };
  if (form) init.body = form;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  if (method !== "GET") {
    const waiting = waitingError();
    if (waiting) throw waiting;
  }
  let res: Response;
  try {
    res = await fetch(`/api/proxy/${path}`, init);
  } catch {
    throw new ApiError(0, "network_error", runtimeT("err.offline"));
  }
  if (!res.ok) return fail(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const commerceApi = {
  // products
  products: (card: string) => call<Product[]>("GET", `cards/${card}/products`),
  createProduct: (card: string, body: ProductInput & { title: string }) => call<Product>("POST", `cards/${card}/products`, body),
  updateProduct: (card: string, id: string, patch: ProductInput) => call<Product>("PATCH", `cards/${card}/products/${id}`, patch),
  deleteProduct: (card: string, id: string) => call<void>("DELETE", `cards/${card}/products/${id}`),
  uploadProductImage: (card: string, id: string, file: File) => {
    const f = new FormData();
    f.append("file", file);
    return call<{ image_url: string }>("POST", `cards/${card}/products/${id}/image`, undefined, f);
  },

  // booking settings
  bookingSettings: (card: string) => call<BookingSettings>("GET", `cards/${card}/booking-settings`),
  saveBookingSettings: (card: string, body: BookingSettings) => call<BookingSettings>("PUT", `cards/${card}/booking-settings`, body),

  // orders (owner and team)
  orders: (ws: string, query: string) => call<Page<Order>>("GET", `workspaces/${ws}/orders?${query}`),
  updateOrder: (ws: string, id: string, patch: { status?: OrderStatus; payment_status?: PaymentStatus; note?: string }) => call<Order>("PATCH", `workspaces/${ws}/orders/${id}`, patch),
  /** Download the CSV of the same filters. `truncated` says the row cap cut the file short. */
  downloadOrdersCsv: async (ws: string, query: string): Promise<{ truncated: boolean }> => {
    const waiting = waitingError();
    if (waiting) throw waiting;
    let res: Response;
    try {
      res = await fetch(`/api/proxy/workspaces/${ws}/orders/export?${query}`, { credentials: "same-origin" });
    } catch {
      throw new ApiError(0, "network_error", runtimeT("err.offline"));
    }
    if (!res.ok) return fail(res);
    const blob = await res.blob();
    const name = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(res.headers.get("content-disposition") ?? "")?.[1];
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = name ? decodeURIComponent(name) : "orders.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 10_000);
    return { truncated: res.headers.get("X-Rows-Truncated") === "1" };
  },

  // bookings (owner and team)
  bookings: (ws: string, query: string) => call<Page<BookingRow>>("GET", `workspaces/${ws}/bookings?${query}`),
  updateBooking: (ws: string, id: string, status: "confirmed" | "cancelled" | "done") => call<BookingRow>("PATCH", `workspaces/${ws}/bookings/${id}`, { status }),
};

export const commerceKeys = {
  products: (card: string) => ["products", card] as const,
  bookingSettings: (card: string) => ["booking-settings", card] as const,
  orders: (ws: string, query: string) => ["orders", ws, query] as const,
  bookings: (ws: string, query: string) => ["bookings", ws, query] as const,
};

// ---------------------------------------------------------------- the visitor's calls (no sign-in)

async function publicCall<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_PUBLIC_URL}/${path}`, {
      method,
      credentials: "omit",
      ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(0, "network_error", runtimeT("err.offline"));
  }
  if (!res.ok) return fail(res);
  return (await res.json().catch(() => ({}))) as T;
}

export interface OrderRequest {
  items: { product_id: string; qty: number }[];
  name: string;
  phone: string;
  email?: string;
  note?: string;
  address?: string;
  payment_method: PaymentMethod;
  consent: boolean;
  opened_at: number;
  source?: EventSource | null;
  website_url: string;
}

export interface OrderPlaced {
  number: string;
  status: OrderStatus;
  total: string;
  currency: string;
}

export interface OrderStatusView {
  number: string;
  status: OrderStatus;
  payment_status: PaymentStatus;
  payment_method: PaymentMethod;
  pay_url: string | null;
  items: OrderLine[];
  subtotal: string;
  total: string;
  currency: string;
  card_name: string;
  created_at: string;
}

export type BookingInfo = { enabled: false } | { enabled: true; timezone: string; slot_minutes: number; days_ahead: number; location_note: string; meet_link: string | null };

export interface Availability {
  timezone: string;
  slot_minutes: number;
  days: AvailabilityDay[];
}

export interface BookingRequest {
  date: string;
  time: string;
  name: string;
  email: string;
  phone?: string;
  note?: string;
  consent: boolean;
  opened_at: number;
  source?: EventSource | null;
  website_url: string;
}

export interface BookingPlaced {
  id: string;
  start_at: string;
  end_at: string;
  status: BookingStatus;
}

const code = encodeURIComponent;

export const publicCommerce = {
  placeOrder: (cardCode: string, body: OrderRequest) => publicCall<OrderPlaced>("POST", `public/cards/${code(cardCode)}/orders`, body),
  orderStatus: (number: string, phone: string) => publicCall<OrderStatusView>("GET", `public/orders/${code(number)}?phone=${code(phone)}`),
  bookingInfo: (cardCode: string) => publicCall<BookingInfo>("GET", `public/cards/${code(cardCode)}/booking`),
  availability: (cardCode: string, from: string, days: number) => publicCall<Availability>("GET", `public/cards/${code(cardCode)}/availability?from=${code(from)}&days=${days}`),
  book: (cardCode: string, body: BookingRequest) => publicCall<BookingPlaced>("POST", `public/cards/${code(cardCode)}/bookings`, body),
  cancelBooking: (id: string, email: string) => publicCall<{ id: string; status: BookingStatus }>("POST", `public/bookings/${code(id)}/cancel?email=${code(email)}`),
};
