"use client";

// The second step of a sign-in: the code from the authenticator app (or a recovery code) after the password or Google.
import { useState } from "react";
import { ApiError } from "@/lib/api";
import { twoFactorApi } from "@/lib/security-api";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import { cleanCode, cleanRecovery } from "@/lib/two-factor";

export function MfaStep({ token, onDone, onBack }: { token: string; onDone: (info: { recoveryLeft?: number }) => void; onBack: () => void }) {
  const { t } = useI18n();
  const [recovery, setRecovery] = useState(false);
  const [value, setValue] = useState("");
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    setErr("");
    setBusy(true);
    try {
      const body = recovery ? { recovery_code: cleanRecovery(value) } : { code: cleanCode(value) };
      const res = await twoFactorApi.signInStep({ mfa_token: token, ...body, remember_device: remember });
      onDone({ recoveryLeft: res.recovery_codes_left });
    } catch (e) {
      if (e instanceof ApiError && e.code === "mfa_token_invalid") {
        setErr(apiErrorText(e, t));
        window.setTimeout(onBack, 1800);
      } else {
        setErr(apiErrorText(e, t, "security.stepFailed"));
      }
      setBusy(false);
    }
  }

  const ready = recovery ? cleanRecovery(value).length >= 10 : cleanCode(value).length === 6;
  return (
    <form className="pane" noValidate onSubmit={(e) => { e.preventDefault(); if (ready && !busy) void submit(); }}>
      <div className="notice" role="note">
        <div className="grow">
          <b>{t("security.stepTitle")}</b>
          {recovery ? t("security.stepRecoveryText") : t("security.stepText")}
        </div>
      </div>
      <label>
        {recovery ? t("security.recoveryCode") : t("security.authCode")}
        <input
          className="ltr"
          dir="ltr"
          autoFocus
          autoComplete="one-time-code"
          inputMode={recovery ? "text" : "numeric"}
          maxLength={recovery ? 24 : 9}
          value={value}
          placeholder={recovery ? "a1b2c-3d4e5" : "123 456"}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={!!err}
        />
      </label>
      <label className="chkrow">
        <input className="chk" type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        {t("security.rememberDevice")}
      </label>
      {err && <div className="notice bad" role="alert">{err}</div>}
      <button className="btn" type="submit" disabled={!ready || busy}>{busy ? t("security.checking") : t("security.verify")}</button>
      <div className="hint">
        <button type="button" className="linkbtn" onClick={() => { setRecovery(!recovery); setValue(""); setErr(""); }}>
          {recovery ? t("security.useAuthApp") : t("security.useRecovery")}
        </button>
        {" "}&middot;{" "}
        <button type="button" className="linkbtn" onClick={onBack}>{t("auth.backToSignIn")}</button>
      </div>
    </form>
  );
}
