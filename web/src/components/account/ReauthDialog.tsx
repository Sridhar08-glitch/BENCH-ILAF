"use client";

// A sensitive change (link or unlink Google, set a password, ask for a data export or its download link) asks for the
// password again when the sign-in is older than a few minutes: the API answers 403 "reauth_required". This dialog asks
// for the password (or a fresh Google sign-in for an account that has none) and the request is repeated with it.
import { useCallback, useState, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { GoogleButton } from "@/components/auth/GoogleButton";
import { Dialog } from "@/components/ops/shared";
import { useWs } from "@/components/app/WorkspaceContext";
import { ApiError, isReauthError } from "@/lib/api";
import type { Confirmation } from "@/lib/account-api";
import { apiErrorText, apiFieldText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";

/** Password, or a fresh Google sign-in for accounts that have no password. */
export function useConfirmation() {
  const { user } = useWs();
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [credential, setCredential] = useState("");
  const usePassword = user.has_password !== false;
  const field = usePassword ? (
    <label>
      {t("settings.yourPassword")}
      <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
    </label>
  ) : (
    <div className="pane" style={{ gap: 8 }}>
      <span className="sechead">{t("settings.confirmGoogle")}</span>
      {credential ? (
        <div className="notice" role="status"><Icon name="check" /><div className="grow">{t("settings.googleConfirmed")}</div></div>
      ) : (
        <GoogleButton text="signin_with" onCredential={setCredential} />
      )}
    </div>
  );
  const proof: Confirmation = usePassword ? { password } : { credential };
  const ready = usePassword ? password.length > 0 : credential.length > 0;
  return { field, proof, ready, usePassword, reset: () => { setPassword(""); setCredential(""); } };
}

/** What `run` gives back when the person closes the dialog without confirming. */
export const CANCELLED = Symbol("reauth-cancelled");

interface Pending {
  fn: (proof: Confirmation) => Promise<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

function ReauthBody({ pending, onClose }: { pending: Pending; onClose: () => void }) {
  const { t } = useI18n();
  const confirmation = useConfirmation();
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setErr("");
    setBusy(true);
    try {
      pending.resolve(await pending.fn(confirmation.proof));
    } catch (e) {
      if (e instanceof ApiError && (e.status === 400 || isReauthError(e))) {
        // A wrong password: stay open so it can be typed again.
        setErr(apiFieldText(e, "password", t) ?? apiFieldText(e, "credential", t) ?? apiErrorText(e, t));
        confirmation.reset();
        setBusy(false);
        return;
      }
      pending.reject(e);
    }
  }

  return (
    <Dialog
      title={t("settings.reauthTitle")}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose}>{t("common.cancel")}</button>
          <button type="button" className="btn" disabled={!confirmation.ready || busy} onClick={submit}>{busy ? t("settings.reauthChecking") : t("settings.reauthConfirm")}</button>
        </>
      }
    >
      <div className="notice" role="note">
        <Icon name="lock" />
        <div className="grow">{confirmation.usePassword ? t("settings.reauthText") : t("settings.reauthTextGoogle")}</div>
      </div>
      {confirmation.field}
      {err && <span className="err" role="alert">{err}</span>}
    </Dialog>
  );
}

/**
 * `run(fn)` calls `fn()` without proof first. If the API wants one (403 reauth_required) the dialog opens and `fn(proof)` is
 * called with the password or Google credential; the result of the successful call is returned. Any other error is thrown as
 * it is. Closing the dialog returns `CANCELLED`. Render `dialog` once in the component.
 */
export function useReauth(): {
  run: <T>(fn: (proof?: Confirmation) => Promise<T>) => Promise<T | typeof CANCELLED>;
  dialog: ReactNode;
} {
  const [pending, setPending] = useState<Pending | null>(null);

  const run = useCallback(<T,>(fn: (proof?: Confirmation) => Promise<T>): Promise<T | typeof CANCELLED> => {
    return new Promise<T | typeof CANCELLED>((resolve, reject) => {
      const finish = (v: unknown) => { setPending(null); resolve(v as T | typeof CANCELLED); };
      const fail = (e: unknown) => { setPending(null); reject(e); };
      fn().then(resolve, (e) => {
        if (!isReauthError(e)) return reject(e);
        setPending({ fn: (proof) => fn(proof), resolve: finish, reject: fail });
      });
    });
  }, []);

  const dialog = pending ? (
    <ReauthBody pending={pending} onClose={() => { pending.resolve(CANCELLED); }} />
  ) : null;
  return { run, dialog };
}
