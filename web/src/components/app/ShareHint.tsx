"use client";

// A one-time, dismissible note for an employee opening Contacts: their contacts are private, and how to share new ones with the company.
import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { useMyMembership } from "@/components/app/ShareContactsCard";
import { useWs } from "@/components/app/WorkspaceContext";
import { useI18n } from "@/lib/i18n/client";
import { hintStorageKey, readHintDismissed, shouldShowShareHint, writeHintDismissed } from "@/lib/sharing/contacts";

export function ShareHint() {
  const { user, current, role, isCompany } = useWs();
  const { t } = useI18n();
  const me = useMyMembership();
  const key = hintStorageKey(user.id, current.id);
  // Read after mount: the server does not know what this browser has stored.
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => setDismissed(readHintDismissed(key)), [key]);
  if (!shouldShowShareHint({ role, isCompany, sharing: me.data?.share_contacts, dismissed })) return null;
  const close = () => {
    writeHintDismissed(key);
    setDismissed(true);
  };
  return (
    <div className="notice" role="note" data-testid="share-hint">
      <Icon name="lock" />
      <div className="grow">
        <b>{t("contacts.shareHintTitle")}</b>
        {t("contacts.shareHintText")}
        <div className="row" style={{ marginBlockStart: 8 }}>
          <Link className="btn sm" href="/app/settings" onClick={close}>{t("contacts.shareHintAction")}</Link>
          <button type="button" className="btn ghost sm" onClick={close}>{t("contacts.shareHintDismiss")}</button>
        </div>
      </div>
    </div>
  );
}
