"use client";

import c from "./Commerce.module.css";
import { Icon } from "@/components/Icon";
import { useI18n } from "@/lib/i18n/client";

/** The bar at the bottom of the page while the basket holds something: "2 items · QAR 42 · Checkout". */
export function CartBar({ count, minor, currency, onOpen }: { count: number; minor: number; currency: string; onOpen: () => void }) {
  const { t, money } = useI18n();
  return (
    <div className={c.bar}>
      <button type="button" className={c.barBtn} onClick={onOpen} aria-label={t("commerce.openBasket")}>
        <span className={c.barInfo}>
          <Icon name="gem" size="s" />
          <span>{t("content.items", { n: count })} · {money(minor, currency)}</span>
        </span>
        <span className={c.barGo}>{t("commerce.checkout")}<Icon name="arrow" size="s" /></span>
      </button>
    </div>
  );
}
