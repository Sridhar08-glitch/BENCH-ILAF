// The visitor's basket on a card page. It lives in the browser (sessionStorage) and is sent as product ids and
// quantities at checkout: the server prices every line again, so nothing here decides what is charged.

export const MAX_QTY = 99;
export const MAX_LINES = 30;

export interface CartLine {
  id: string;
  title: string;
  /** Price in the smallest unit (cents, fils), so sums never carry rounding noise. */
  minor: number;
  currency: string;
  qty: number;
  image_url: string | null;
}

export interface Cart {
  lines: CartLine[];
}

export const EMPTY_CART: Cart = { lines: [] };

export type AddResult = { cart: Cart; problem: null } | { cart: Cart; problem: "currency" | "lines" };

/** "12.50" or 12.5 as whole minor units (1250); null when it is not a usable amount. */
export function toMinor(price: string | number | null | undefined): number | null {
  const text = typeof price === "number" ? String(price) : String(price ?? "").trim();
  if (text === "") return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** Minor units as a plain number of the main unit (1250 -> 12.5), for the number formatter. */
export function fromMinor(minor: number): number {
  return minor / 100;
}

export interface CartProduct {
  id: string;
  title: string;
  price: string | number;
  currency: string;
  image_url: string | null;
}

/** Put one more of a product in the basket. A basket holds one currency and up to MAX_LINES different products. */
export function addProduct(cart: Cart, product: CartProduct, qty = 1): AddResult {
  const minor = toMinor(product.price);
  if (minor === null) return { cart, problem: null };
  const existing = cart.lines.find((l) => l.id === product.id);
  if (existing) {
    const next = Math.min(MAX_QTY, existing.qty + qty);
    return { cart: { lines: cart.lines.map((l) => (l.id === product.id ? { ...l, qty: next } : l)) }, problem: null };
  }
  if (cart.lines.length > 0 && cart.lines[0].currency !== product.currency) return { cart, problem: "currency" };
  if (cart.lines.length >= MAX_LINES) return { cart, problem: "lines" };
  const line: CartLine = { id: product.id, title: product.title, minor, currency: product.currency, qty: Math.min(MAX_QTY, Math.max(1, qty)), image_url: product.image_url };
  return { cart: { lines: [...cart.lines, line] }, problem: null };
}

/** Set a line's quantity; zero or less removes it. */
export function setQty(cart: Cart, id: string, qty: number): Cart {
  const q = Math.floor(qty);
  if (!Number.isFinite(q) || q <= 0) return removeLine(cart, id);
  return { lines: cart.lines.map((l) => (l.id === id ? { ...l, qty: Math.min(MAX_QTY, q) } : l)) };
}

export function removeLine(cart: Cart, id: string): Cart {
  return { lines: cart.lines.filter((l) => l.id !== id) };
}

export function totals(cart: Cart): { count: number; minor: number; currency: string } {
  let count = 0;
  let minor = 0;
  for (const l of cart.lines) {
    count += l.qty;
    minor += l.minor * l.qty;
  }
  return { count, minor, currency: cart.lines[0]?.currency ?? "" };
}

/** What the order request carries: ids and quantities only. */
export function orderItems(cart: Cart): { product_id: string; qty: number }[] {
  return cart.lines.map((l) => ({ product_id: l.id, qty: l.qty }));
}

export const cartKey = (code: string) => `bench:cart:${code}`;

/** Read a saved basket; anything unreadable is an empty basket. */
export function parseCart(raw: string | null): Cart {
  if (!raw) return EMPTY_CART;
  try {
    const data = JSON.parse(raw) as { lines?: unknown };
    if (!Array.isArray(data.lines)) return EMPTY_CART;
    const lines: CartLine[] = [];
    for (const l of data.lines as Partial<CartLine>[]) {
      if (typeof l?.id !== "string" || typeof l.title !== "string" || typeof l.currency !== "string") continue;
      const minor = Number(l.minor);
      const qty = Math.floor(Number(l.qty));
      if (!Number.isFinite(minor) || minor < 0 || !Number.isFinite(qty) || qty < 1) continue;
      lines.push({ id: l.id, title: l.title, minor, currency: l.currency, qty: Math.min(MAX_QTY, qty), image_url: typeof l.image_url === "string" ? l.image_url : null });
      if (lines.length >= MAX_LINES) break;
    }
    return { lines };
  } catch {
    return EMPTY_CART;
  }
}

export function loadCart(code: string): Cart {
  try {
    return parseCart(window.sessionStorage.getItem(cartKey(code)));
  } catch {
    return EMPTY_CART;
  }
}

export function saveCart(code: string, cart: Cart): void {
  try {
    if (cart.lines.length === 0) window.sessionStorage.removeItem(cartKey(code));
    else window.sessionStorage.setItem(cartKey(code), JSON.stringify(cart));
  } catch {
    /* private mode: the basket just lives on the screen */
  }
}
