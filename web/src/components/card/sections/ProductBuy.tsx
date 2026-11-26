"use client";

import type { PublicProduct } from "@/lib/public-api";
import s from "./sections.module.css";

/** The name of the browser event a product button sends; the cart bar listens for it and adds the product. */
export const ADD_TO_CART_EVENT = "bench:cart:add";

export interface AddToCartDetail {
  code: string;
  product: PublicProduct;
}

/** The button on a product. It only announces the wish to buy; the cart (a separate client part) keeps the basket. */
export function ProductBuy({ code, product, label, small, soldOut }: { code: string; product: PublicProduct; label: string; small?: boolean; soldOut?: string }) {
  const out = product.sold_out === true || (product.stock !== null && product.stock !== undefined && product.stock <= 0);
  if (out) return <span className={s.soldout}>{soldOut}</span>;
  return (
    <button
      type="button"
      className={`${s.btn}${small ? ` ${s.sm}` : ""}`}
      data-product={product.id}
      onClick={() => window.dispatchEvent(new CustomEvent<AddToCartDetail>(ADD_TO_CART_EVENT, { detail: { code, product } }))}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 7h12l1 13H5zM9 10V6a3 3 0 0 1 6 0v4" /></svg>
      {label}
    </button>
  );
}
