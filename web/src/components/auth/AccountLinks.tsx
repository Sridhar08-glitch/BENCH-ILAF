"use client";

// Pages reached from an e-mail: restore a scheduled account deletion, and download a data export.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { authApi, downloadExport, privacyApi } from "@/lib/account-api";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import { formatSize } from "@/lib/privacy";

export function RestoreByLink({ token }: { token: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [expired, setExpired] = useState(false);
  return (
    <div className="pane">
      <div className="notice">
        <div className="grow">
          <b>{t("auth.switchedOff")}</b>
          {t("auth.restoreText")}
        </div>
      </div>
      {err && <div className="notice bad" role="alert"><div className="grow">{err}</div></div>}
      {expired ? (
        <Link className="btn" href="/login">{t("auth.signInToRestore")}</Link>
      ) : (
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setErr("");
            try {
              await authApi.restore({ token });
              router.replace("/app");
              router.refresh();
            } catch (e) {
              if (e instanceof ApiError && e.code === "restore_invalid") {
                setErr(t("auth.restoreLinkExpired"));
                setExpired(true);
              } else setErr(apiErrorText(e, t, "auth.generic"));
              setBusy(false);
            }
          }}
        >
          {busy ? t("auth.restoring") : t("auth.restoreAccount")}
        </button>
      )}
    </div>
  );
}

type Check = { state: "checking" } | { state: "ok"; scope: "user" | "workspace"; expires_at: string; size: number } | { state: "bad"; text: string };

export function DownloadData({ token }: { token: string }) {
  const { t, dateTime } = useI18n();
  const [check, setCheck] = useState<Check>({ state: "checking" });
  const [started, setStarted] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [dlError, setDlError] = useState("");

  async function startDownload() {
    setDlError("");
    setDownloading(true);
    try {
      await downloadExport(token);
      setStarted(true);
    } catch (e) {
      setDlError(e instanceof ApiError ? (e.code === "download_expired" ? t("auth.dlExpired") : e.code === "download_used" ? t("auth.dlUsed") : apiErrorText(e, t)) : t("auth.dlInvalid"));
    } finally {
      setDownloading(false);
    }
  }

  useEffect(() => {
    let live = true;
    privacyApi
      .checkDownload(token)
      .then((r) => live && setCheck({ state: "ok", scope: r.scope, expires_at: r.expires_at, size: r.file_size }))
      .catch((e) => {
        if (!live) return;
        const message =
          e instanceof ApiError && e.code === "download_expired" ? t("auth.dlExpired")
          : e instanceof ApiError && e.code === "download_used" ? t("auth.dlUsed")
          : e instanceof ApiError && e.status === 0 ? apiErrorText(e, t)
          : t("auth.dlInvalid");
        setCheck({ state: "bad", text: message });
      });
    return () => {
      live = false;
    };
  }, [token, t]);

  if (check.state === "checking") return <div className="notice" role="status"><div className="grow">{t("auth.checking")}</div></div>;
  if (check.state === "bad") {
    return (
      <div className="pane">
        <div className="notice bad" role="alert"><div className="grow">{check.text}</div></div>
        <Link className="btn ghost" href="/app/settings/privacy">{t("auth.goPrivacy")}</Link>
      </div>
    );
  }
  return (
    <div className="pane">
      <div className="notice" role="status">
        <div className="grow">
          <b>{check.scope === "workspace" ? t("auth.readyCompany") : t("auth.readyUser")}</b>
          {t("auth.readyText", { size: formatSize(check.size), when: dateTime(check.expires_at) })}
        </div>
      </div>
      {started ? (
        <div className="notice" role="status"><div className="grow"><b>{t("auth.dlStartedTitle")}</b>{t("auth.dlStartedText")}</div></div>
      ) : (
        <>
          <button type="button" className="btn" disabled={downloading} onClick={() => void startDownload()}>{downloading ? t("auth.dlPreparing") : t("auth.downloadButton")}</button>
          {dlError && <span className="err" role="alert">{dlError}</span>}
        </>
      )}
    </div>
  );
}
