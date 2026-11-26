"use client";

// The parts the basket checkout and the booking calendar share with the contact form: the white sheet, its keys, the
// consent line and the finished screen. Same look and same protection (a hidden honeypot field, the time the sheet was
// opened and the visitor's consent).
import { useEffect, type FormEvent, type ReactNode } from "react";
import styles from "./PublicCard.module.css";
import x from "./Exchange.module.css";
import { Icon } from "@/components/Icon";
import { useI18n } from "@/lib/i18n/client";

/** Escape closes the sheet, and the first field gets the focus. */
export function useSheetKeys(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
}

export function Sheet({ id, title, onClose, onSubmit, children }: { id: string; title: string; onClose: () => void; onSubmit?: (e: FormEvent) => void; children: ReactNode }) {
  useSheetKeys(onClose);
  return (
    <div className={styles.modal} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={id} onSubmit={onSubmit} noValidate>
        <h2 id={id}>{title}</h2>
        {children}
      </form>
    </div>
  );
}

export function Honeypot({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  return (
    <div className={styles.hp} aria-hidden="true">
      <label>
        {t("card.formWebsite")}
        <input tabIndex={-1} autoComplete="off" name="website_url" value={value} onChange={(e) => onChange(e.target.value)} />
      </label>
    </div>
  );
}

export function ConsentLine({ id, text, checked, onChange }: { id: string; text: string; checked: boolean; onChange: (v: boolean) => void }) {
  const { t } = useI18n();
  return (
    <>
      <label className={x.check} htmlFor={id}>
        <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span>{text}</span>
      </label>
      <p className={x.fine}>
        {t("card.formNotice")} <a href="/privacy" target="_blank" rel="noopener noreferrer">{t("common.privacy")}</a>
      </p>
    </>
  );
}

export function Finished({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const { t } = useI18n();
  useSheetKeys(onClose);
  return (
    <div className={styles.modal} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="commerce-done">
        <div className={x.success}>
          <span className={x.tick} aria-hidden="true"><Icon name="check" size="l" /></span>
          <h2 id="commerce-done">{title}</h2>
          {children}
          <button type="button" className="btn ghost" onClick={onClose} autoFocus>{t("card.close")}</button>
        </div>
      </div>
    </div>
  );
}

/** A usable phone number has at least six digits; the API compares the digits only. */
export function phoneOk(phone: string): boolean {
  return phone.replace(/\D/g, "").length >= 6;
}

export function emailOk(email: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
}
