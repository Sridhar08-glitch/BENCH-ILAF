"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/Icon";
import { Switch } from "@/components/app/Switch";
import { useToast } from "@/components/app/ui";
import { commerceApi, commerceKeys, type Product } from "@/lib/api-commerce";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import { tk, type MessageKey } from "@/lib/i18n";
import { IMAGE_ACCEPT, isAllowedImage } from "@/lib/images";
import { PRODUCTS_LAYOUTS, type ProductsLayout } from "@/lib/public-api";
import { CountedField, SectionTitle } from "./SectionTitle";
import type { SectionFormProps } from "./types";
import c from "./content.module.css";

export const MAX_PRODUCTS = 60;
const MAX_IMAGE = 8 * 1024 * 1024;
const LAYOUT_NAME: Record<ProductsLayout, MessageKey> = {
  grid: tk("commerce.layoutGrid"), carousel: tk("commerce.layoutCarousel"), menu: tk("commerce.layoutMenu"), listings: tk("commerce.layoutListings"),
};

/** A price typed by hand: digits with an optional point or comma, two decimals at most. Returns the API's text ("12.50") or null. */
export function cleanPrice(raw: string): string | null {
  const text = raw.trim().replace(",", ".");
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(text)) return null;
  return Number(text).toFixed(2);
}

/** Stock typed by hand: empty means unlimited. */
export function cleanStock(raw: string): number | null | undefined {
  const text = raw.trim();
  if (text === "") return null;
  if (!/^\d{1,6}$/.test(text)) return undefined;
  return Number(text);
}

export function ProductsForm({ ed, section, onChange, disabled }: SectionFormProps<"products">) {
  const { t, number } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const cardId = ed.card.id;
  const q = useQuery({ queryKey: commerceKeys.products(cardId), queryFn: () => commerceApi.products(cardId) });
  const all = q.data ?? [];
  // A product belongs to this block, or to none yet (then every products block shows it).
  const mine = all.filter((p) => p.section_id === section.id || p.section_id === null).sort((a, b) => a.order - b.order);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setList = (list: Product[]) => qc.setQueryData(commerceKeys.products(cardId), list);
  const layout = section.data.layout;

  async function add() {
    setBusy(true);
    try {
      const made = await commerceApi.createProduct(cardId, { title: t("commerce.newProduct"), price: "0.00", section_id: section.id, order: mine.length });
      setList([...all, made]);
      setOpen(made.id);
    } catch (e) {
      toast(apiErrorText(e, t, "commerce.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SectionTitle value={section.data.title} disabled={disabled} onChange={(title) => onChange({ ...section.data, title })} placeholder={t("content.defProducts")} />
      <label>
        {t("commerce.layout")}
        <select value={layout} disabled={disabled} onChange={(e) => onChange({ ...section.data, layout: e.target.value as ProductsLayout })}>
          {PRODUCTS_LAYOUTS.map((l) => <option key={l} value={l}>{t(LAYOUT_NAME[l])}</option>)}
        </select>
      </label>
      {q.isLoading && <div className="skeleton" style={{ height: 80 }} />}
      {!q.isLoading && mine.length === 0 && <p className="hint">{t("commerce.productsEmpty")}</p>}
      <div className={c.rows}>
        {mine.map((p) => (
          <ProductRow key={p.id} cardId={cardId} product={p} layout={layout} open={open === p.id} disabled={disabled}
            onToggle={() => setOpen(open === p.id ? null : p.id)}
            onSaved={(next) => setList(all.map((x) => (x.id === next.id ? next : x)))}
            onDeleted={() => { setList(all.filter((x) => x.id !== p.id)); setOpen(null); }} />
        ))}
      </div>
      <div className="row">
        <button type="button" className="btn ghost sm" disabled={disabled || busy || all.length >= MAX_PRODUCTS} onClick={() => void add()}>
          <Icon name="plus" size="s" />{t("commerce.addProduct")}
        </button>
        <span className="hint">{all.length >= MAX_PRODUCTS ? t("commerce.productsFull", { n: number(MAX_PRODUCTS) }) : t("commerce.productsCount", { n: number(all.length), max: number(MAX_PRODUCTS) })}</span>
      </div>
    </>
  );
}

function ProductRow({ cardId, product, layout, open, disabled, onToggle, onSaved, onDeleted }: {
  cardId: string; product: Product; layout: ProductsLayout; open: boolean; disabled: boolean;
  onToggle: () => void; onSaved: (p: Product) => void; onDeleted: () => void;
}) {
  const { t, number, money } = useI18n();
  const toast = useToast();
  const [draft, setDraft] = useState(product);
  const [price, setPrice] = useState(product.price);
  const [stock, setStock] = useState(product.stock === null ? "" : String(product.stock));
  const [uploading, setUploading] = useState(false);
  const timer = useRef<number>(0);
  const latest = useRef(draft);
  const waiting = useRef<Partial<Product>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  /** Keep the screen's copy and send every change made during the pause in one request. */
  function edit(patch: Partial<Product>) {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setDraft(next);
    waiting.current = { ...waiting.current, ...patch };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      const body = waiting.current;
      waiting.current = {};
      try {
        const saved = await commerceApi.updateProduct(cardId, product.id, body);
        onSaved({ ...saved, ...latest.current, image_url: saved.image_url });
      } catch (e) {
        toast(apiErrorText(e, t, "commerce.saveFailed"));
      }
    }, 700);
  }

  const meta = (key: string, value: string) => {
    const m = { ...(latest.current.meta ?? {}) } as Record<string, unknown>;
    if (value.trim()) m[key] = value.trim();
    else delete m[key];
    edit({ meta: m });
  };
  const text = (k: string) => (typeof draft.meta?.[k] === "string" || typeof draft.meta?.[k] === "number" ? String(draft.meta[k]) : "");

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (!isAllowedImage(file)) return toast(t("common.useImage"));
    if (file.size > MAX_IMAGE) return toast(t("editor.pictureTooLarge", { mb: number(MAX_IMAGE / (1024 * 1024)) }));
    setUploading(true);
    try {
      const r = await commerceApi.uploadProductImage(cardId, product.id, file);
      const next = { ...latest.current, image_url: r.image_url };
      latest.current = next;
      setDraft(next);
      onSaved(next);
    } catch (e) {
      toast(apiErrorText(e, t, "commerce.saveFailed"));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removeImage() {
    try {
      const saved = await commerceApi.updateProduct(cardId, product.id, { image: null });
      const next = { ...latest.current, image_url: saved.image_url };
      latest.current = next;
      setDraft(next);
      onSaved(next);
    } catch (e) {
      toast(apiErrorText(e, t, "commerce.saveFailed"));
    }
  }

  async function remove() {
    if (!window.confirm(t("commerce.removeProductConfirm", { title: draft.title }))) return;
    try {
      await commerceApi.deleteProduct(cardId, product.id);
      onDeleted();
    } catch (e) {
      toast(apiErrorText(e, t, "commerce.saveFailed"));
    }
  }

  const priceBad = price.trim() !== "" && cleanPrice(price) === null;
  const stockBad = cleanStock(stock) === undefined;
  return (
    <div>
      <div className={`${c.row} ${open ? c.open : ""} ${draft.on ? "" : c.off}`}>
        <span className={c.chip} aria-hidden="true">{draft.image_url ? <img src={draft.image_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit" }} /> : <Icon name="gem" size="s" />}</span>
        <button type="button" className={c.name} aria-expanded={open} onClick={onToggle}>
          <b dir="auto">{draft.title || t("commerce.newProduct")}</b>
          <small>{money(Math.round(Number(draft.price) * 100), draft.currency)}{draft.stock !== null ? ` · ${t("commerce.inStock", { n: number(draft.stock) })}` : ""}</small>
        </button>
        <Switch checked={draft.on} disabled={disabled} label={t("commerce.showProduct")} onChange={(on) => edit({ on })} />
      </div>
      {open && (
        <div className={c.form}>
          <CountedField label={t("commerce.productName")} value={draft.title} max={80} disabled={disabled} onChange={(title) => edit({ title })} />
          <CountedField label={t("commerce.productDesc")} value={draft.description} max={300} multiline disabled={disabled} onChange={(description) => edit({ description })} />
          <div className="two">
            <label>
              {t("commerce.price")}
              <input className="ltr" inputMode="decimal" value={price} disabled={disabled} aria-invalid={priceBad} onChange={(e) => {
                setPrice(e.target.value);
                const ok = cleanPrice(e.target.value);
                if (ok !== null) edit({ price: ok });
              }} />
              {priceBad && <span className="hint" role="alert">{t("commerce.priceBad")}</span>}
            </label>
            <label>
              {t("commerce.currency")}
              <input className="ltr" maxLength={3} value={draft.currency} disabled={disabled} onChange={(e) => {
                const v = e.target.value.toUpperCase().replace(/[^A-Z]/g, "");
                if (v.length === 3) edit({ currency: v });
                else setDraft({ ...draft, currency: v });
              }} />
            </label>
          </div>
          <div className="two">
            <label>
              {t("commerce.stock")}
              <input className="ltr" inputMode="numeric" value={stock} placeholder={t("commerce.stockUnlimited")} disabled={disabled} aria-invalid={stockBad} onChange={(e) => {
                setStock(e.target.value);
                const v = cleanStock(e.target.value);
                if (v !== undefined) edit({ stock: v });
              }} />
            </label>
            <CountedField label={t("commerce.badge")} value={draft.badge} max={20} disabled={disabled} placeholder={t("commerce.badgeHint")} onChange={(badge) => edit({ badge })} />
          </div>
          {layout === "menu" && <CountedField label={t("commerce.category")} value={text("category")} max={40} disabled={disabled} hint={t("commerce.categoryHint")} onChange={(v) => meta("category", v)} />}
          {layout === "listings" && (
            <div className="two">
              <CountedField label={t("content.beds")} value={text("beds")} max={10} disabled={disabled} onChange={(v) => meta("beds", v)} />
              <CountedField label={t("content.baths")} value={text("baths")} max={10} disabled={disabled} onChange={(v) => meta("baths", v)} />
              <CountedField label={t("content.size")} value={text("size")} max={20} disabled={disabled} onChange={(v) => meta("size", v)} />
            </div>
          )}
          <div className="row">
            <input ref={fileRef} type="file" accept={IMAGE_ACCEPT} hidden onChange={(e) => void onFile(e.target.files?.[0])} />
            <button type="button" className="btn ghost sm" disabled={disabled || uploading} onClick={() => fileRef.current?.click()}>
              <Icon name="upload" size="s" />{uploading ? t("editor.uploading") : t("commerce.productImage")}
            </button>
            {draft.image_url && <button type="button" className="btn ghost sm" disabled={disabled} onClick={() => void removeImage()}><Icon name="trash" size="s" />{t("commerce.removeImage")}</button>}
          </div>
          <div className="row">
            <button type="button" className="btn ghost sm" disabled={disabled} onClick={() => void remove()}><Icon name="trash" size="s" />{t("commerce.removeProduct")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
