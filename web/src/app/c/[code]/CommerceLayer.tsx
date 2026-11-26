"use client";

// The two things a card page can do besides showing: sell (the product buttons fill a basket kept in this browser tab,
// the bar at the bottom opens the checkout) and take bookings (the "Book a time" button opens the calendar). The server
// parts only draw the buttons; this client part listens for them.
import { useCallback, useEffect, useRef, useState } from "react";
import c from "./Commerce.module.css";
import { BookingDialog } from "./BookingDialog";
import { CartBar } from "./CartBar";
import { CheckoutDialog } from "./CheckoutDialog";
import { ADD_TO_CART_EVENT, type AddToCartDetail } from "@/components/card/sections/ProductBuy";
import { EMPTY_CART, MAX_LINES, addProduct, loadCart, saveCart, totals, type Cart } from "@/lib/commerce/cart";
import { useI18n } from "@/lib/i18n/client";
import type { EventSource } from "@/lib/types";

export function CommerceLayer({ code, source, name, preview }: { code: string; source: EventSource | null; name: string; /** The owner's preview: the basket and the forms work, nothing is sent. */ preview?: boolean }) {
  const { t } = useI18n();
  const [cart, setCart] = useState<Cart>(EMPTY_CART);
  const [ready, setReady] = useState(false);
  const [checkout, setCheckout] = useState(false);
  const [booking, setBooking] = useState(false);
  const [note, setNote] = useState("");
  const cartRef = useRef(cart);
  cartRef.current = cart;
  const timer = useRef<number>(0);

  const say = useCallback((text: string) => {
    setNote(text);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setNote(""), 2200);
  }, []);

  // The basket survives a reload of the page but not a closed tab.
  useEffect(() => {
    setCart(loadCart(code));
    setReady(true);
  }, [code]);
  useEffect(() => {
    if (ready) saveCart(code, cart);
  }, [cart, code, ready]);

  useEffect(() => {
    const onAdd = (e: Event) => {
      const detail = (e as CustomEvent<AddToCartDetail>).detail;
      if (!detail || detail.code !== code) return;
      const p = detail.product;
      const r = addProduct(cartRef.current, { id: p.id, title: p.title, price: p.price, currency: p.currency, image_url: p.image_url });
      if (r.problem === "currency") return say(t("commerce.errCurrency"));
      if (r.problem === "lines") return say(t("commerce.errLines", { n: MAX_LINES }));
      setCart(r.cart);
      say(t("commerce.added", { title: p.title }));
    };
    window.addEventListener(ADD_TO_CART_EVENT, onAdd);
    return () => window.removeEventListener(ADD_TO_CART_EVENT, onAdd);
  }, [code, say, t]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.("[data-book]");
      if (el && el.getAttribute("data-book") === code) {
        e.preventDefault();
        setBooking(true);
      }
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [code]);

  const sum = totals(cart);
  return (
    <>
      {note && <div className={c.note} role="status"><span>{note}</span></div>}
      {sum.count > 0 && !checkout && <CartBar count={sum.count} minor={sum.minor} currency={sum.currency} onOpen={() => setCheckout(true)} />}
      {checkout && (
        <CheckoutDialog
          code={code}
          source={source}
          sellerName={name}
          cart={cart}
          onCart={setCart}
          onPlaced={() => setCart(EMPTY_CART)}
          onClose={() => setCheckout(false)}
          preview={preview}
        />
      )}
      {booking && <BookingDialog code={code} source={source} hostName={name} onClose={() => setBooking(false)} preview={preview} />}
    </>
  );
}
