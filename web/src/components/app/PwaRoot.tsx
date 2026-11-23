"use client";

// The installable-app parts of the signed-in screens: registers the service worker, offers "Install", shows "Update available".
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import styles from "./pwa.module.css";
import { APP_NAME } from "@/lib/config";
import { useI18n } from "@/lib/i18n/client";
import { DISMISS_KEY, detectPlatform, installOffer, isStandalone, type Platform } from "@/lib/pwa/install";
import { registerServiceWorker, type Updater } from "@/lib/pwa/register";

// The event Chrome and Edge fire when the app can be installed; it is not in the standard DOM types.
interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function readDismissed(): number | null {
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function PwaRoot() {
  const { t } = useI18n();
  const [update, setUpdate] = useState<Updater | null>(null);
  const [platform, setPlatform] = useState<Platform>("desktop");
  const [standalone, setStandalone] = useState(true);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [hasPrompt, setHasPrompt] = useState(false);
  const [showIos, setShowIos] = useState(false);
  const deferred = useRef<InstallEvent | null>(null);

  useEffect(() => {
    void registerServiceWorker((u) => setUpdate(u));
    setPlatform(detectPlatform(navigator.userAgent, navigator.maxTouchPoints));
    setStandalone(isStandalone({ matchMedia: window.matchMedia?.bind(window), navigatorStandalone: (navigator as Navigator & { standalone?: boolean }).standalone }));
    setDismissedAt(readDismissed());
    const onPrompt = (e: Event) => {
      e.preventDefault();
      deferred.current = e as InstallEvent;
      setHasPrompt(true);
    };
    const onInstalled = () => {
      deferred.current = null;
      setHasPrompt(false);
      setStandalone(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const offer = installOffer({ platform, standalone, hasPrompt, dismissedAt, now: Date.now() });

  function dismiss() {
    const now = Date.now();
    setDismissedAt(now);
    setShowIos(false);
    try {
      window.localStorage.setItem(DISMISS_KEY, String(now));
    } catch {
      /* private mode: the offer just comes back next time */
    }
  }

  async function install() {
    const e = deferred.current;
    if (!e) return;
    try {
      await e.prompt();
      const choice = await e.userChoice;
      if (choice.outcome === "dismissed") dismiss();
    } catch {
      /* the browser refused; the offer stays */
    }
    deferred.current = null;
    setHasPrompt(false);
  }

  return (
    <>
      {update && (
        <div className={styles.bar} role="status" aria-live="polite">
          <Icon name="download" size="s" />
          <div className={styles.grow}><b>{t("growth.pwaUpdate")}</b> {t("growth.pwaUpdateText", { app: APP_NAME })}</div>
          <button type="button" className="btn sm" onClick={() => update.apply()}>{t("growth.pwaRefresh")}</button>
        </div>
      )}

      {offer !== "none" && !update && (
        <div className={styles.bar} role="region" aria-label={t("growth.pwaInstall", { app: APP_NAME })}>
          <Icon name="download" size="s" />
          <div className={styles.grow}><b>{t("growth.pwaInstall", { app: APP_NAME })}</b> {t("growth.pwaInstallText", { app: APP_NAME })}</div>
          {offer === "prompt" ? (
            <button type="button" className="btn sm" onClick={() => void install()}>{t("growth.pwaInstallButton")}</button>
          ) : (
            <button type="button" className="btn sm" onClick={() => setShowIos(true)}>{t("growth.pwaIosHow")}</button>
          )}
          <button type="button" className="x" aria-label={t("growth.pwaLater")} title={t("growth.pwaLater")} onClick={dismiss}><Icon name="x2" size="s" /></button>
        </div>
      )}

      {showIos && (
        <div className="sheet fixed" style={{ justifyContent: "center", alignItems: "center", padding: 16 }} onClick={(e) => e.target === e.currentTarget && setShowIos(false)}>
          <div className="panel card" style={{ width: "100%", maxWidth: 420 }} role="dialog" aria-modal="true" aria-label={t("growth.pwaIosTitle", { app: APP_NAME })}>
            <h2>{t("growth.pwaIosTitle", { app: APP_NAME })}</h2>
            <ol style={{ margin: 0, paddingInlineStart: 20, display: "grid", gap: 8 }}>
              <li>{t("growth.pwaIosStep1")}</li>
              <li>{t("growth.pwaIosStep2")}</li>
              <li>{t("growth.pwaIosStep3", { app: APP_NAME })}</li>
            </ol>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn ghost" onClick={dismiss}>{t("growth.pwaLater")}</button>
              <button type="button" className="btn" onClick={() => setShowIos(false)}>{t("common.close")}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
