"use client";

// Shown when there is no connection: the owner's own QR codes, kept on this device, drawn here with no network at all.
import { useEffect, useMemo, useState } from "react";
import { Logo } from "@/components/Logo";
import { APP_NAME } from "@/lib/config";
import { qrModules } from "@/lib/card/qr";
import { useI18n } from "@/lib/i18n/client";
import { loadOfflineQrs } from "@/lib/pwa/store";
import type { OfflineQr } from "@/lib/pwa/offline-qr";
import { qrSvg } from "@/lib/qr/render";
import { eccFor } from "@/lib/qr/style";

function dataUrl(entry: OfflineQr, which: "link" | "contact"): string | null {
  const text = which === "link" ? entry.linkText : entry.contactText;
  if (!text) return null;
  const hasLogo = !!entry.logoHref && entry.style.logo !== "none";
  const modules = qrModules(text, eccFor(entry.style, hasLogo)) ?? qrModules(text, "M");
  if (!modules) return null;
  const { svg } = qrSvg(modules, entry.style, { logoHref: hasLogo ? entry.logoHref : null, width: 640 });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function OfflineView() {
  const { t, date } = useI18n();
  const [entries, setEntries] = useState<OfflineQr[] | null>(null);
  const [which, setWhich] = useState<"link" | "contact">("link");

  useEffect(() => {
    let live = true;
    void loadOfflineQrs().then((e) => live && setEntries(e));
    return () => {
      live = false;
    };
  }, []);

  const anyContact = useMemo(() => (entries ?? []).some((e) => e.contactText), [entries]);

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: "24px 16px 48px", display: "grid", gap: 18 }}>
      <Logo href="/app" />
      <div>
        <h1 style={{ margin: 0 }}>{t("growth.offlineTitle")}</h1>
        <p className="sub">{t("growth.offlineText", { app: APP_NAME })}</p>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn" onClick={() => window.location.reload()}>{t("growth.offlineRetry")}</button>
      </div>

      <h2 style={{ margin: 0 }}>{t("growth.offlineQrHead")}</h2>
      {entries === null ? (
        <div className="skeleton" style={{ height: 260 }} aria-hidden />
      ) : entries.length === 0 ? (
        <div className="notice" role="status"><div className="grow">{t("growth.offlineNone")}</div></div>
      ) : (
        <>
          {anyContact && (
            <div role="group" aria-label={t("growth.offlineQrHead")} className="seg" style={{ alignSelf: "flex-start" }}>
              <button type="button" aria-pressed={which === "link"} onClick={() => setWhich("link")}>{t("growth.offlineLink")}</button>
              <button type="button" aria-pressed={which === "contact"} onClick={() => setWhich("contact")}>{t("growth.offlineContact")}</button>
            </div>
          )}
          {entries.map((e) => {
            const url = dataUrl(e, which) ?? dataUrl(e, "link");
            return (
              <section key={e.id} className="panel card" style={{ alignItems: "center", textAlign: "center" }}>
                <b dir="auto" style={{ fontSize: 18 }}>{e.name}</b>
                {(e.title || e.company) && <div className="hint" dir="auto">{[e.title, e.company].filter(Boolean).join(" - ")}</div>}
                {url && <img src={url} alt={t("growth.qrStyledAlt", { name: e.name })} style={{ width: "min(100%, 320px)", height: "auto", background: "#fff", borderRadius: 12 }} />}
                <div className="hint ltr" style={{ overflowWrap: "anywhere" }}>{e.publicUrl}</div>
                <div className="hint">{t("growth.offlineSaved", { date: date(new Date(e.savedAt).toISOString()) })}</div>
              </section>
            );
          })}
        </>
      )}
    </main>
  );
}
