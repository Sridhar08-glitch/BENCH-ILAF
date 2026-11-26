"use client";

// The checkout of a card's basket: what is in it, who is buying and how they will pay. The server prices every line
// again and reduces the stock, so this sheet only sends product ids and quantities.
import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import c from "./Commerce.module.css";
import { ConsentLine, Finished, Honeypot, Sheet, emailOk, phoneOk } from "./CommerceShell";
import { Icon } from "@/components/Icon";
import { publicCommerce, type OrderPlaced, type PaymentMethod } from "@/lib/api-commerce";
import { orderItems, setQty, removeLine, totals, type Cart } from "@/lib/commerce/cart";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import type { EventSource } from "@/lib/types";

interface Props {
  code: string;
  source: EventSource | null;
  sellerName: string;
  cart: Cart;
  onCart: (cart: Cart) => void;
  /** The order was accepted: the basket is emptied. */
  onPlaced: () => void;
  onClose: () => void;
  /** The owner's preview: the form works, but nothing is sent. */
  preview?: boolean;
}

const METHODS: { id: PaymentMethod; on: boolean }[] = [
  { id: "cod", on: true },
  { id: "whatsapp", on: true },
  { id: "card_later", on: false },
];

export function CheckoutDialog({ code, source, sellerName, cart, onCart, onPlaced, onClose, preview }: Props) {
  const { t, money, number } = useI18n();
  const [form, setForm] = useState({ name: "", phone: "", email: "", address: "", note: "", website_url: "" });
  const [method, setMethod] = useState<PaymentMethod>("cod");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [placed, setPlaced] = useState<OrderPlaced | null>(null);
  const [previewDone, setPreviewDone] = useState(false);
  const opened = useRef(Date.now());
  const sum = totals(cart);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function problem(): string | null {
    if (cart.lines.length === 0) return t("commerce.basketEmpty");
    if (!form.name.trim()) return t("card.errName");
    if (!phoneOk(form.phone)) return t("commerce.errPhone");
    if (form.email.trim() && !emailOk(form.email)) return t("card.errEmail");
    if (!consent) return t("card.errConsent");
    return null;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const stop = problem();
    if (stop) return setError(stop);
    if (preview) return setPreviewDone(true);
    setBusy(true);
    setError("");
    try {
      const done = await publicCommerce.placeOrder(code, {
        items: orderItems(cart),
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim() || undefined,
        address: form.address.trim() || undefined,
        note: form.note.trim() || undefined,
        payment_method: method,
        consent: true,
        opened_at: opened.current,
        source,
        website_url: form.website_url,
      });
      setPlaced(done);
      onPlaced();
    } catch (err) {
      setError(apiErrorText(err, t, "commerce.sendFailed"));
      setBusy(false);
    }
  }

  if (previewDone) {
    return (
      <Finished title={t("commerce.previewTitle")} onClose={onClose}>
        <p>{t("commerce.previewOrderText")}</p>
      </Finished>
    );
  }

  if (placed) {
    return (
      <Finished title={t("commerce.placedTitle")} onClose={onClose}>
        <p>{t("commerce.placedText", { number: placed.number, name: sellerName })}</p>
        <Link className="btn" href={`/order/${encodeURIComponent(placed.number)}?phone=${encodeURIComponent(form.phone.trim())}`}>{t("commerce.trackOrder")}</Link>
      </Finished>
    );
  }

  return (
    <Sheet id="checkout-title" title={t("commerce.checkoutTitle")} onClose={onClose} onSubmit={submit}>
      {cart.lines.length === 0 ? (
        <p>{t("commerce.basketEmpty")}</p>
      ) : (
        <>
          <ul className={c.lines}>
            {cart.lines.map((l) => (
              <li key={l.id} className={c.line}>
                <span className={c.thumb} aria-hidden="true">{l.image_url ? <img src={l.image_url} alt="" /> : <Icon name="gem" size="s" />}</span>
                <span className={c.lineName}>
                  <b dir="auto">{l.title}</b>
                  <small>{money(l.minor, l.currency)}</small>
                </span>
                <span className={c.qty}>
                  <button type="button" aria-label={t("commerce.lessOf", { title: l.title })} onClick={() => onCart(setQty(cart, l.id, l.qty - 1))}>−</button>
                  <span aria-live="polite">{number(l.qty)}</span>
                  <button type="button" aria-label={t("commerce.moreOf", { title: l.title })} onClick={() => onCart(setQty(cart, l.id, l.qty + 1))}>+</button>
                  <button type="button" aria-label={t("commerce.removeOf", { title: l.title })} onClick={() => onCart(removeLine(cart, l.id))}><Icon name="trash" size="s" /></button>
                </span>
              </li>
            ))}
          </ul>
          <div className={c.sum}><span>{t("commerce.total")}</span><b>{money(sum.minor, sum.currency)}</b></div>
        </>
      )}

      <label>
        <span>{t("card.formName")}<span aria-hidden="true"> *</span></span>
        <input value={form.name} onChange={set("name")} autoComplete="name" required />
      </label>
      <div className="two">
        <label>
          <span>{t("commerce.phoneLabel")}<span aria-hidden="true"> *</span></span>
          <input className="ltr" type="tel" inputMode="tel" value={form.phone} onChange={set("phone")} autoComplete="tel" required />
        </label>
        <label>
          <span>{t("commerce.emailLabel")}</span>
          <input className="ltr" type="email" value={form.email} onChange={set("email")} autoComplete="email" />
        </label>
      </div>
      <label>
        <span>{t("commerce.addressLabel")}</span>
        <textarea dir="auto" rows={2} maxLength={300} value={form.address} onChange={set("address")} autoComplete="street-address" />
      </label>
      <label>
        <span>{t("commerce.noteLabel")}</span>
        <textarea dir="auto" rows={2} maxLength={500} value={form.note} onChange={set("note")} />
      </label>

      <fieldset className={c.pays}>
        <legend>{t("commerce.payHead")}</legend>
        {METHODS.map((m) => (
          <label key={m.id} className={c.pay} data-on={method === m.id} aria-disabled={!m.on}>
            <input type="radio" name="pay" value={m.id} checked={method === m.id} disabled={!m.on} onChange={() => setMethod(m.id)} />
            {t(m.id === "cod" ? "commerce.payCod" : m.id === "whatsapp" ? "commerce.payWhatsapp" : "commerce.payCard")}
          </label>
        ))}
      </fieldset>

      <Honeypot value={form.website_url} onChange={(v) => setForm((f) => ({ ...f, website_url: v }))} />
      <ConsentLine id="order-consent" text={t("commerce.consent", { name: sellerName })} checked={consent} onChange={setConsent} />
      {error && <p className={c.error} role="alert">{error}</p>}
      <button type="submit" className="btn" disabled={busy || cart.lines.length === 0}>{busy ? t("commerce.sending") : t("commerce.placeOrder", { total: money(sum.minor, sum.currency) })}</button>
      <button type="button" className="btn ghost" onClick={onClose}>{t("commerce.keepShopping")}</button>
    </Sheet>
  );
}
