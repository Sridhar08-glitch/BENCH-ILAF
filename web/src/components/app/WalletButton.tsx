"use client";

// "Add to Google Wallet" for a published card. The button only exists when the server has Google Wallet
// set up and the card is live; otherwise nothing is shown. Apple Wallet is not built yet, so iPhones see a note.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@/lib/api";
import { walletApi } from "@/lib/account-api";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import { isAppleDevice, isGoogleSaveUrl } from "@/lib/wallet";
import { useFlags } from "@/lib/flags";
import { useWs } from "./WorkspaceContext";
import styles from "./WalletButton.module.css";

function WalletGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3" />
      <path d="M4 7.5V17a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2H6.5A2.5 2.5 0 0 1 4 5.5" />
      <path d="M16 13.5h2.5" />
    </svg>
  );
}

/** The button, unless the product team switched Google Wallet off for this company. */
export function WalletButton(props: { cardId: string; published: boolean }) {
  const { current } = useWs();
  const flags = useFlags(current.id);
  return flags.wallet_google ? <WalletButtonInner {...props} /> : null;
}

function WalletButtonInner({ cardId, published }: { cardId: string; published: boolean }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // The first answer only tells whether the button should exist; the link is made again when it is tapped.
  const probe = useQuery({
    queryKey: ["wallet-google", cardId],
    queryFn: () => walletApi.google(cardId),
    enabled: published,
    retry: false,
    staleTime: Infinity,
  });
  if (!published || !probe.data) return null;

  async function add() {
    setErr("");
    setBusy(true);
    const tab = window.open("", "_blank");
    try {
      const { save_url } = await walletApi.google(cardId);
      if (!isGoogleSaveUrl(save_url)) throw new ApiError(502, "error", t("dash.walletBadLink"));
      if (tab) tab.location.href = save_url;
      else window.location.assign(save_url);
    } catch (e) {
      tab?.close();
      setErr(apiErrorText(e, t, "dash.walletFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className={styles.wrap}>
      <button type="button" className={styles.btn} onClick={add} disabled={busy} aria-label={t("dash.walletAdd")}>
        <WalletGlyph />
        <span>{t("dash.walletAdd")}</span>
      </button>
      {isAppleDevice() && <small className="hint">{t("dash.walletApple")}</small>}
      {err && <small className="err" role="alert">{err}</small>}
    </span>
  );
}
