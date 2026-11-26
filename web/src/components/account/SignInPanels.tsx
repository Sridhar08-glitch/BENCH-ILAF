"use client";

// Settings, Sign-in methods: link or unlink Google, set a first password, and (company owners) the
// company sign-in rules: allowed e-mail domains and "Require Google sign-in".
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/Icon";
import { GoogleButton } from "@/components/auth/GoogleButton";
import { Switch } from "@/components/app/Switch";
import { useToast } from "@/components/app/ui";
import { EnterpriseLock } from "@/components/app/EnterpriseLock";
import { useWs } from "@/components/app/WorkspaceContext";
import { ApiError, api } from "@/lib/api";
import { authApi, privacyApi, type Confirmation } from "@/lib/account-api";
import { Dialog } from "@/components/ops/shared";
import { useSignOutGuard } from "@/components/app/SignOutGuard";
import { clearOfflineData } from "@/lib/pwa/store";
import { CANCELLED, useReauth } from "./ReauthDialog";
import { googleEnabled, googleErrorText } from "@/lib/google";
import { keys, useWorkspaceDetail } from "@/lib/hooks";
import { apiErrorText, apiFieldText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import { looksLikeDomain, parseDomains } from "@/lib/privacy";

export function GooglePanel() {
  const { user } = useWs();
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const linked = !!user.google_linked;
  const hasPassword = user.has_password !== false;

  const reauth = useReauth();

  async function run(fn: (proof?: Confirmation) => Promise<unknown>, done: string) {
    setErr("");
    setBusy(true);
    try {
      const r = await reauth.run(fn);
      if (r === CANCELLED) return;
      await qc.invalidateQueries({ queryKey: keys.me });
      toast(done);
    } catch (e) {
      setErr(e instanceof ApiError ? googleErrorText(e.code, apiErrorText(e, t), t) : t("settings.genericError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel card" aria-labelledby="google-h">
      <div className="head"><h2 id="google-h"><span className="chip"><Icon name="user" size="s" /></span>{t("settings.googleTitle")}</h2></div>
      {linked ? (
        <>
          <div className="notice" role="status">
            <Icon name="check" />
            <div className="grow"><b>{t("settings.googleConnected")}</b>{user.google_email ? t("settings.googleConnectedEmail", { email: user.google_email }) : t("settings.googleConnectedText")}</div>
          </div>
          {!hasPassword && <div className="hint">{t("settings.googleSetPasswordFirst")}</div>}
          <div>
            <button type="button" className="btn ghost" disabled={busy || !hasPassword} onClick={() => run((proof) => authApi.unlinkGoogle(proof), t("settings.googleDisconnected"))}>{t("settings.googleDisconnect")}</button>
          </div>
        </>
      ) : googleEnabled() ? (
        <>
          <div className="hint">{t("settings.googleConnectHint")}</div>
          <GoogleButton text="continue_with" onUnavailable={setErr} onCredential={(c) => run((proof) => authApi.linkGoogle(c, proof), t("settings.googleLinked"))} />
        </>
      ) : (
        <div className="hint">{t("settings.googleOff")}</div>
      )}
      {err && <span className="err" role="alert">{err}</span>}
      {reauth.dialog}
    </section>
  );
}

export function SetPasswordPanel() {
  const { user } = useWs();
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [pw, setPw] = useState("");
  const [again, setAgain] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const reauth = useReauth();
  if (user.has_password !== false) return null; // accounts with a password use Change password

  const mismatch = again.length > 0 && pw !== again;
  return (
    <form
      className="panel card"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        if (pw.length < 8) return setErr(t("settings.pwMin"));
        if (pw !== again) return setErr(t("settings.pwMismatch"));
        setErr("");
        setBusy(true);
        try {
          const r = await reauth.run((proof) => authApi.setPassword(pw, proof));
          if (r === CANCELLED) return;
          setPw("");
          setAgain("");
          await qc.invalidateQueries({ queryKey: keys.me });
          toast(t("settings.passwordSet"));
        } catch (e2) {
          setErr(e2 instanceof ApiError ? (apiFieldText(e2, "new_password", t) ?? apiErrorText(e2, t)) : t("settings.passwordSetFailed"));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="head"><h2><span className="chip"><Icon name="lock" size="s" /></span>{t("settings.setPassword")}</h2></div>
      <div className="hint">{t("settings.setPasswordHint")}</div>
      <label>{t("settings.newPassword")}<input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
      <label>{t("settings.repeatPassword")}<input type="password" autoComplete="new-password" aria-invalid={mismatch} value={again} onChange={(e) => setAgain(e.target.value)} /></label>
      {err && <span className="err" role="alert">{err}</span>}
      <button type="submit" className="btn" disabled={busy}>{t("settings.setPasswordButton")}</button>
      {reauth.dialog}
    </form>
  );
}

export function CompanySecurityPanel() {
  const { current, isCompany, role, has } = useWs();
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const detail = useWorkspaceDetail(isCompany ? current.id : "");
  const security = detail.data?.security;
  const [domains, setDomains] = useState<string | null>(null);
  const [requireGoogle, setRequireGoogle] = useState<boolean | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  if (!isCompany || (role !== "owner" && role !== "admin") || !security) return null;
  if (!has("sign_in_rules")) {
    return (
      <div className="panel card">
        <div className="head"><h2><span className="chip"><Icon name="lock" size="s" /></span>{t("settings.secTitle")}</h2></div>
        <EnterpriseLock compact />
      </div>
    );
  }

  const isOwner = role === "owner";
  const text = domains ?? security.allowed_email_domains.join("\n");
  const on = requireGoogle ?? security.require_google_signin;
  const parsed = parseDomains(text);
  const bad = parsed.filter((d) => !looksLikeDomain(d));

  return (
    <form
      className="panel card"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        if (bad.length) return setErr(t("settings.secBadDomain", { domain: `⁦${bad[0]}⁩` }));
        setErr("");
        setBusy(true);
        try {
          await privacyApi.saveSecurity(current.id, { allowed_email_domains: parsed, require_google_signin: on });
          await qc.invalidateQueries({ queryKey: keys.workspace(current.id) });
          setDomains(null);
          setRequireGoogle(null);
          toast(t("settings.secSaved"));
        } catch (e2) {
          setErr(apiErrorText(e2, t, "settings.saveFailed"));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="head"><h2><span className="chip"><Icon name="lock" size="s" /></span>{t("settings.secTitle")}</h2></div>
      <label>
        {t("settings.secDomains")}
        <textarea className="ltr" rows={3} value={text} placeholder={"northgate.com"} disabled={!isOwner} onChange={(e) => setDomains(e.target.value)} />
      </label>
      <div className="hint">{t("settings.secDomainsHint")}</div>
      <div className="toggle first">
        <div>
          {t("settings.secRequireGoogle")}
          <small>{t("settings.secRequireGoogleHint")}</small>
        </div>
        <Switch checked={on} onChange={setRequireGoogle} label={t("settings.secRequireGoogle")} disabled={!isOwner} />
      </div>
      {on && !googleEnabled() && <div className="notice warn" role="status"><div className="grow">{t("settings.secGoogleOff")}</div></div>}
      {err && <span className="err" role="alert">{err}</span>}
      {isOwner ? <button type="submit" className="btn" disabled={busy}>{t("settings.secSave")}</button> : <div className="hint">{t("settings.secOwnerOnly")}</div>}
    </form>
  );
}

/** Ends every sign-in of this account on every device, this one included. */
export function SignOutAllPanel() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const { guard, dialog: unsentDialog } = useSignOutGuard();
  async function signOutEverywhere() {
    setErr("");
    setBusy(true);
    try {
      await api.logoutAll();
    } catch (e) {
      setErr(apiErrorText(e, t, "settings.genericError"));
      setBusy(false);
      return;
    }
    try {
      await api.logout(); // clears the cookies of this device
    } finally {
      await clearOfflineData(); // this device is signed out: what it kept for the account goes too
      qc.clear();
      window.location.assign("/login");
    }
  }

  return (
    <section className="panel card" aria-labelledby="signout-all-h">
      <div className="head"><h2 id="signout-all-h"><span className="chip"><Icon name="logout" size="s" className="flip-rtl" /></span>{t("settings.signOutAllTitle")}</h2></div>
      <div className="hint">{t("settings.signOutAllHint")}</div>
      <div><button type="button" className="btn ghost" onClick={() => setOpen(true)}>{t("settings.signOutAllButton")}</button></div>
      {open && (
        <Dialog
          title={t("settings.signOutAllConfirmTitle")}
          onClose={() => !busy && setOpen(false)}
          footer={
            <>
              <button type="button" className="btn ghost" disabled={busy} onClick={() => setOpen(false)}>{t("common.cancel")}</button>
              <button type="button" className="btn danger" disabled={busy} onClick={() => guard(signOutEverywhere)}>{busy ? t("settings.signOutAllBusy") : t("settings.signOutAllConfirm")}</button>
            </>
          }
        >
          <div className="notice warn" role="note"><Icon name="alert" /><div className="grow">{t("settings.signOutAllConfirmText")}</div></div>
          {err && <span className="err" role="alert">{err}</span>}
        </Dialog>
      )}
      {unsentDialog}
    </section>
  );
}
