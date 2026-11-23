"use client";

// Small shared pieces: loading, error and empty states, the upgrade prompt, toasts, QR preview.
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import QRCode from "qrcode";
import { Icon } from "@/components/Icon";
import { ApiError, isClosedForDeletion, isUpgradeError } from "@/lib/api";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";

export function Loading({ full, label }: { full?: boolean; label?: string }) {
  const { t } = useI18n();
  return (
    <div role="status" aria-live="polite" style={{ padding: full ? "30vh 16px" : 24, textAlign: "center" }}>
      <div className="skeleton" style={{ height: 10, width: 120, margin: "0 auto 10px" }} />
      <span className="hint">{label ?? t("dash.uiLoading")}...</span>
    </div>
  );
}

export function SkeletonBlocks({ rows = 3 }: { rows?: number }) {
  return (
    <div className="pane" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ height: 64 }} />
      ))}
    </div>
  );
}

/** Friendly prompt when the plan does not allow something or has no live subscription. */
export function UpgradeNotice({ error }: { error: ApiError }) {
  const { t } = useI18n();
  const need = error.code === "subscription_required";
  return (
    <div className="notice warn" role="alert">
      <Icon name="crown" />
      <div className="grow">
        <b>{need ? t("dash.uiUpgradeNeed") : t("dash.uiUpgradeLimit")}</b>
        {apiErrorText(error, t)}
        <div style={{ marginBlockStart: 8 }}>
          <Link className="btn sm" href="/app/billing">{t("dash.uiSeePlans")}</Link>
        </div>
      </div>
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useI18n();
  if (isUpgradeError(error)) return <UpgradeNotice error={error} />;
  if (isClosedForDeletion(error)) {
    return (
      <div className="notice bad" role="alert">
        <Icon name="lock" />
        <div className="grow">{t("shell.closedErrorInline")}</div>
      </div>
    );
  }
  const msg = apiErrorText(error, t, "dash.uiGenericError");
  return (
    <div className="notice bad" role="alert">
      <Icon name="alert" />
      <div className="grow">
        <b>{t("dash.uiLoadFailed")}</b>
        {msg}
        {onRetry && (
          <div style={{ marginBlockStart: 8 }}>
            <button type="button" className="btn ghost sm" onClick={onRetry}>{t("common.retry")}</button>
          </div>
        )}
      </div>
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="empty">
      <b>{title}</b>
      {children && <span>{children}</span>}
      {action}
    </div>
  );
}

export function PageHead({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="top">
      <div>
        <h1>{title}</h1>
        {sub && <p className="sub">{sub}</p>}
      </div>
      {children && <div className="row">{children}</div>}
    </div>
  );
}

export function Avatar({ name, url }: { name: string; url?: string | null }) {
  const ini = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
  return <div className="av">{url ? <img src={url} alt="" /> : ini}</div>;
}

// ---- toasts

const ToastCtx = createContext<(msg: string) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState("");
  const show = useCallback((m: string) => {
    setMsg(m);
    window.setTimeout(() => setMsg(""), 2400);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && (
        <div className="toast" role="status">
          <span>{msg}</span>
        </div>
      )}
    </ToastCtx.Provider>
  );
}

// ---- QR preview (drawn in the page; downloads use the API's own qr.svg)

/** An in-page QR code for a link. */
export function QrPreview({ text, label }: { text: string; label?: string }) {
  const { t } = useI18n();
  const [svg, setSvg] = useState("");
  useEffect(() => {
    let live = true;
    QRCode.toString(text, { type: "svg", margin: 1, errorCorrectionLevel: "Q", color: { dark: "#070707", light: "#ffffff" } })
      .then((s) => live && setSvg(s))
      .catch(() => live && setSvg(""));
    return () => {
      live = false;
    };
  }, [text]);
  return <span className="qrx" role="img" aria-label={label ?? t("dash.uiQrFor", { text })} style={{ display: "block", width: "100%", height: "100%" }} dangerouslySetInnerHTML={{ __html: svg }} />;
}
