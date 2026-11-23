"use client";

// The "New Contact" screen a visitor sees after tapping Save contact. It looks like a phone's own
// contact sheet and shows exactly the fields that will be added.
import { useEffect, useRef } from "react";
import { Icon } from "@/components/Icon";
import { initials } from "@/lib/card/design";
import { useI18n } from "@/lib/i18n/client";
import { tk, type MessageKey } from "@/lib/i18n";
import type { ContactPreview } from "@/lib/card/vcard";

/** The contact details list, also used inline in the editor's "phone preview". */
/** The field names a contact file can carry, in the language of the page. Any other label is shown as it is. */
const ROW_LABELS: Record<string, MessageKey> = {
  mobile: tk("card.vcMobile"), work: tk("card.vcWork"), home: tk("card.vcHome"), phone: tk("card.vcPhone"), url: tk("card.vcUrl"),
  website: tk("card.vcWebsite"), link: tk("card.vcLink"), "my card": tk("card.vcMyCard"),
};

export function ContactBody({ c, photoUrl }: { c: ContactPreview; photoUrl?: string | null }) {
  const { t } = useI18n();
  return (
    <>
      <div className="cp">
        <div className="ca">
          {c.hasPhoto ? photoUrl ? <img src={photoUrl} alt="" /> : initials(c.name) : <Icon name="user" size="l" />}
        </div>
        <b dir="auto">{c.name}</b>
        <small dir="auto">{c.subtitle}</small>
      </div>
      <div className="cl">
        {c.rows.map((r, i) => (
          <div className="cr" key={`${r.label}-${i}`}>
            <small>{ROW_LABELS[r.label] ? t(ROW_LABELS[r.label]) : r.label}</small>
            <span dir="auto">{r.value}</span>
          </div>
        ))}
        {c.note && (
          <div className="cr">
            <small>{t("card.note")}</small>
            <span className="plain" dir="auto">{c.note}</span>
          </div>
        )}
      </div>
    </>
  );
}

interface Props {
  contact: ContactPreview;
  photoUrl?: string | null;
  /** "fixed" covers the whole screen (public page); "absolute" stays inside the phone preview. */
  position: "fixed" | "absolute";
  /** Tapping Add. Return value is ignored; the sheet shows "Saved" and closes. */
  onAdd: () => void;
  onClose: () => void;
  /** Link that downloads the contact file (makes Add a real download). */
  downloadHref?: string;
}

export function SaveSheet({ contact, photoUrl, position, onAdd, onClose, downloadHref }: Props) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>("button, a");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className={`sheet ${position === "fixed" ? "fixed" : ""}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sh" role="dialog" aria-modal="true" aria-label={t("card.newContact")} ref={ref}>
        <div className="sh-h">
          <button type="button" onClick={onClose}>{t("common.cancel")}</button>
          <b>{t("card.newContact")}</b>
          {downloadHref ? (
            <a
              href={downloadHref}
              download
              onClick={() => {
                onAdd();
                setTimeout(onClose, 900);
              }}
              style={{ color: "#007AFF", fontWeight: 600, textDecoration: "none", padding: 4 }}
            >
              {t("card.add")}
            </a>
          ) : (
            <button
              type="button"
              onClick={() => {
                onAdd();
                setTimeout(onClose, 600);
              }}
            >
              {t("card.add")}
            </button>
          )}
        </div>
        <div className="sh-b">
          <ContactBody c={contact} photoUrl={photoUrl} />
        </div>
      </div>
    </div>
  );
}
