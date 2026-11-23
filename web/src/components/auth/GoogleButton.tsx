"use client";

// "Continue with Google". Google's script is loaded here, only on the pages that show the button,
// and the button is hidden when no client id is set.
import { useEffect, useRef, useState } from "react";
import { GOOGLE_CLIENT_ID, googleEnabled, loadGsi } from "@/lib/google";
import { useI18n } from "@/lib/i18n/client";
import styles from "./GoogleButton.module.css";

interface Props {
  /** Called with the signed Google ID token. */
  onCredential: (credential: string) => void;
  text?: "continue_with" | "signin_with" | "signup_with";
  /** Show the "or" divider above the button (sign-in pages). */
  divider?: boolean;
  onUnavailable?: (message: string) => void;
}

export function GoogleButton({ onCredential, text = "continue_with", divider = false, onUnavailable }: Props) {
  const { t, locale } = useI18n();
  const host = useRef<HTMLDivElement>(null);
  const callback = useRef(onCredential);
  const unavailable = useRef(onUnavailable);
  const message = useRef(t("auth.googleUnavailable"));
  const [failed, setFailed] = useState(false);
  callback.current = onCredential;
  unavailable.current = onUnavailable;
  message.current = t("auth.googleUnavailable");

  useEffect(() => {
    if (!googleEnabled()) return;
    let cancelled = false;
    loadGsi()
      .then(() => {
        const gsi = window.google?.accounts.id;
        if (cancelled || !gsi || !host.current) return;
        gsi.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (r) => {
            if (r.credential) callback.current(r.credential);
          },
          auto_select: false,
        });
        const width = Math.min(400, Math.max(220, Math.floor(host.current.getBoundingClientRect().width) || 320));
        // Google draws its own button text in the language it is given.
        gsi.renderButton(host.current, { type: "standard", theme: "outline", size: "large", text, shape: "pill", logo_alignment: "left", width, locale });
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        unavailable.current?.(message.current);
      });
    return () => {
      cancelled = true;
    };
  }, [text, locale]);

  if (!googleEnabled() || failed) return null;
  return (
    <div className={styles.wrap}>
      {divider && <div className={styles.or}><span>{t("common.or")}</span></div>}
      <div ref={host} className={styles.host} aria-label={t("auth.googleContinue")} />
    </div>
  );
}
