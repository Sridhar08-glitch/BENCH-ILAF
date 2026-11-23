"use client";

// Every way of signing out of this device goes through `guard`: with unsent event notes on the device it first asks (signing out
// deletes them), otherwise it signs out at once. The dialog closes with Escape, which means "stay signed in".
import { useCallback, useState } from "react";
import { Dialog } from "@/components/ops/shared";
import { Icon } from "@/components/Icon";
import { CSV_HEADER, TAG_NAMES } from "@/lib/event/labels";
import { loadNotes } from "@/lib/event/notes";
import { signOutStep, unsentCsv, unsentFileName, unsentNotes } from "@/lib/event/signout";
import { useI18n } from "@/lib/i18n/client";
import { saveBlob } from "@/lib/qr/client";

const storage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export function useSignOutGuard(): { guard: (go: () => void | Promise<void>) => void; dialog: React.ReactNode } {
  const { t } = useI18n();
  const [pending, setPending] = useState<{ count: number; go: () => void | Promise<void> } | null>(null);
  const [exported, setExported] = useState(false);

  const guard = useCallback((go: () => void | Promise<void>) => {
    const count = unsentNotes(loadNotes(storage())).length;
    if (signOutStep(count) === "now") {
      void go();
      return;
    }
    setExported(false);
    setPending({ count, go });
  }, []);

  function exportNotes() {
    const csv = unsentCsv(loadNotes(storage()), (tag) => (tag ? t(TAG_NAMES[tag]) : ""), CSV_HEADER.map((k) => t(k)), { yes: t("growth.eventCsvYes"), no: t("growth.eventCsvNo") });
    saveBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), unsentFileName(t("shell.unsentFile"), new Date()));
    setExported(true);
  }

  const dialog = pending ? (
    <Dialog
      title={t("shell.unsentTitle")}
      onClose={() => setPending(null)}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={() => setPending(null)}>{t("shell.unsentStay")}</button>
          <button type="button" className="btn ghost" onClick={exportNotes}><Icon name="download" size="s" />{t("shell.unsentExport")}</button>
          <button type="button" className="btn danger" onClick={() => { const go = pending.go; setPending(null); void go(); }}>{t("shell.unsentSignOut")}</button>
        </>
      }
    >
      <div className="notice warn" role="note"><Icon name="alert" /><div className="grow">{t("shell.unsentText", { n: pending.count })}</div></div>
      <span className="hint" role="status">{exported ? t("shell.unsentExported") : ""}</span>
    </Dialog>
  ) : null;

  return { guard, dialog };
}
