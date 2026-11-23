"use client";

// The sign-in family of forms: login, register, forgot password, reset password and accept invite.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useForm, type FieldValues, type Path, type UseFormSetError } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ApiError, api } from "@/lib/api";
import { authApi } from "@/lib/account-api";
import { googleErrorText } from "@/lib/google";
import { apiErrorText, apiFieldText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import type { TFunction } from "@/lib/i18n";
import { useThrottleWait } from "@/lib/throttle-hook";
import { isMfaChallenge } from "@/lib/security-api";
import { GoogleButton } from "./GoogleButton";
import { MfaStep } from "./MfaStep";

/** Send API field errors to the matching form fields; everything else becomes one message. */
function showApiError<T extends FieldValues>(e: unknown, setError: UseFormSetError<T>, setGeneral: (m: string) => void, t: TFunction) {
  if (e instanceof ApiError) {
    let any = false;
    for (const [name, msgs] of Object.entries(e.fields)) {
      setError(name as Path<T>, { message: apiFieldText(e, name, t) ?? msgs[0] });
      any = true;
    }
    if (!any || e.code !== "validation_error") setGeneral(apiErrorText(e, t));
  } else {
    setGeneral(t("auth.generic"));
  }
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label>
      {label}
      {children}
      {error && <span className="err" role="alert">{error}</span>}
    </label>
  );
}

/** While the API asks to slow down the submit button stays off and this line says for how long. */
function WaitNote({ wait }: { wait: number }) {
  const { t } = useI18n();
  if (wait <= 0) return null;
  return <div className="notice warn" role="status" aria-live="polite"><div className="grow">{t("err.throttledNote", { n: wait })}</div></div>;
}

function safeNext(next: string | null): string {
  return next && next.startsWith("/app") && !next.startsWith("//") ? next : "/app";
}

/** Shown when a correct sign-in belongs to an account that is waiting to be deleted: one button brings it back. */
function RestoreNotice({ until, onRestore }: { until: string; onRestore: () => Promise<void> }) {
  const { t, date } = useI18n();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <div className="notice warn" role="alert">
      <div className="grow">
        <b>{t("auth.scheduledTitle")}</b>
        {until ? t("auth.scheduledTextUntil", { date: date(until) }) : t("auth.scheduledText")}
        {err && <span className="err" role="alert" style={{ display: "block", marginBlockStart: 6 }}>{err}</span>}
        <button
          type="button"
          className="btn sm"
          style={{ marginBlockStart: 10 }}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setErr("");
            try {
              await onRestore();
            } catch (e) {
              setErr(apiErrorText(e, t, "auth.restoreFailed"));
              setBusy(false);
            }
          }}
        >
          {busy ? t("auth.restoring") : t("auth.restoreAccount")}
        </button>
      </div>
    </div>
  );
}

const emailRule = (t: TFunction) => z.string().trim().min(1, t("auth.errEnterEmail")).email(t("auth.errValidEmail"));
const newPasswordRule = (t: TFunction) => z.string().min(8, t("auth.errPasswordMin"));

// ---- login

const loginSchema = (t: TFunction) => z.object({ email: emailRule(t), password: z.string().min(1, t("auth.errEnterPassword")) });
type LoginValues = z.infer<ReturnType<typeof loginSchema>>;

export function LoginForm() {
  const { t } = useI18n();
  const router = useRouter();
  const wait = useThrottleWait();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const justDeleted = params.get("deleted") === "1";
  const [general, setGeneral] = useState("");
  const [scheduled, setScheduled] = useState<{ until: string; restore: () => Promise<void> } | null>(null);
  // After the password (or Google) an account with 2-step verification asks for its code before the session starts.
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const schema = useMemo(() => loginSchema(t), [t]);
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<LoginValues>({ resolver: zodResolver(schema) });
  const finish = () => {
    router.replace(next);
    router.refresh();
  };
  const offerRestore = (e: ApiError, body: Parameters<typeof authApi.restore>[0]) =>
    setScheduled({
      until: e.field("restore_until") ?? "",
      restore: async () => {
        const r = await authApi.restore(body);
        if (isMfaChallenge(r)) {
          setScheduled(null);
          setMfaToken(r.mfa_token);
        } else finish();
      },
    });

  if (mfaToken) return <MfaStep token={mfaToken} onDone={finish} onBack={() => setMfaToken(null)} />;

  return (
    <form
      className="pane"
      noValidate
      onSubmit={handleSubmit(async (v) => {
        setGeneral("");
        setScheduled(null);
        try {
          const r = await api.login(v.email, v.password);
          if (isMfaChallenge(r)) setMfaToken(r.mfa_token);
          else finish();
        } catch (e) {
          if (e instanceof ApiError && e.code === "account_scheduled_for_deletion") offerRestore(e, { email: v.email, password: v.password });
          else showApiError(e, setError, setGeneral, t);
        }
      })}
    >
      {justDeleted && !scheduled && (
        <div className="notice warn" role="status">
          <div className="grow"><b>{t("auth.justDeletedTitle")}</b>{t("auth.justDeletedText")}</div>
        </div>
      )}
      <Field label={t("common.email")} error={errors.email?.message}>
        <input type="email" autoComplete="email" aria-invalid={!!errors.email} {...register("email")} />
      </Field>
      <Field label={t("common.password")} error={errors.password?.message}>
        <input type="password" autoComplete="current-password" aria-invalid={!!errors.password} {...register("password")} />
      </Field>
      {general && <div className="notice bad" role="alert">{general}</div>}
      {scheduled && <RestoreNotice until={scheduled.until} onRestore={scheduled.restore} />}
      <WaitNote wait={wait} />
      <button className="btn" type="submit" disabled={isSubmitting || wait > 0}>{isSubmitting ? t("auth.signingIn") : t("auth.signIn")}</button>
      <GoogleButton
        divider
        onUnavailable={setGeneral}
        onCredential={async (credential) => {
          setGeneral("");
          setScheduled(null);
          try {
            const r = await authApi.google(credential);
            if (isMfaChallenge(r)) setMfaToken(r.mfa_token);
            else finish();
          } catch (e) {
            if (e instanceof ApiError && e.code === "account_scheduled_for_deletion") offerRestore(e, { credential });
            else setGeneral(e instanceof ApiError ? googleErrorText(e.code, apiErrorText(e, t), t) : t("auth.generic"));
          }
        }}
      />
      <div className="hint">
        <Link href="/forgot">{t("auth.forgotLink")}</Link> &middot; <Link href={`/register`}>{t("auth.createAccountLink")}</Link>
      </div>
    </form>
  );
}

// ---- register

const registerSchema = (t: TFunction) => z.object({ full_name: z.string().trim().min(2, t("auth.errFullName")), email: emailRule(t), password: newPasswordRule(t) });
type RegisterValues = z.infer<ReturnType<typeof registerSchema>>;

export function RegisterForm() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const wait = useThrottleWait();
  const [general, setGeneral] = useState("");
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const schema = useMemo(() => registerSchema(t), [t]);
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<RegisterValues>({ resolver: zodResolver(schema) });

  if (mfaToken) return <MfaStep token={mfaToken} onDone={() => { router.replace("/app"); router.refresh(); }} onBack={() => setMfaToken(null)} />;

  return (
    <form
      className="pane"
      noValidate
      onSubmit={handleSubmit(async (v) => {
        setGeneral("");
        try {
          // The account starts in the language the visitor is using.
          await api.register(v.email, v.password, v.full_name, locale);
          router.replace("/app");
          router.refresh();
        } catch (e) {
          if (e instanceof ApiError && e.code === "email_taken") setError("email", { message: t("auth.emailTaken") });
          else showApiError(e, setError, setGeneral, t);
        }
      })}
    >
      <Field label={t("auth.fullName")} error={errors.full_name?.message}>
        <input autoComplete="name" dir="auto" aria-invalid={!!errors.full_name} {...register("full_name")} />
      </Field>
      <Field label={t("common.email")} error={errors.email?.message}>
        <input type="email" autoComplete="email" aria-invalid={!!errors.email} {...register("email")} />
      </Field>
      <Field label={t("common.password")} error={errors.password?.message}>
        <input type="password" autoComplete="new-password" aria-invalid={!!errors.password} {...register("password")} />
      </Field>
      {general && <div className="notice bad" role="alert">{general}</div>}
      <WaitNote wait={wait} />
      <button className="btn" type="submit" disabled={isSubmitting || wait > 0}>{isSubmitting ? t("auth.creating") : t("auth.createAccount")}</button>
      <GoogleButton
        divider
        text="signup_with"
        onUnavailable={setGeneral}
        onCredential={async (credential) => {
          setGeneral("");
          try {
            const r = await authApi.google(credential);
            if (isMfaChallenge(r)) {
              setMfaToken(r.mfa_token);
              return;
            }
            router.replace("/app");
            router.refresh();
          } catch (e) {
            setGeneral(e instanceof ApiError ? googleErrorText(e.code, apiErrorText(e, t), t) : t("auth.generic"));
          }
        }}
      />
      <div className="hint">{t("auth.haveAccount")} <Link href="/login">{t("auth.signIn")}</Link></div>
    </form>
  );
}

// ---- forgot

const forgotSchema = (t: TFunction) => z.object({ email: emailRule(t) });
type ForgotValues = z.infer<ReturnType<typeof forgotSchema>>;

export function ForgotForm() {
  const { t } = useI18n();
  const [sent, setSent] = useState(false);
  const wait = useThrottleWait();
  const [general, setGeneral] = useState("");
  const schema = useMemo(() => forgotSchema(t), [t]);
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<ForgotValues>({ resolver: zodResolver(schema) });

  if (sent) {
    return (
      <div className="notice" role="status">
        <div className="grow">
          <b>{t("auth.checkEmail")}</b>
          {t("auth.checkEmailText")}
        </div>
      </div>
    );
  }
  return (
    <form
      className="pane"
      noValidate
      onSubmit={handleSubmit(async (v) => {
        setGeneral("");
        try {
          await api.forgot(v.email);
          setSent(true);
        } catch (e) {
          showApiError(e, setError, setGeneral, t);
        }
      })}
    >
      <Field label={t("common.email")} error={errors.email?.message}>
        <input type="email" autoComplete="email" aria-invalid={!!errors.email} {...register("email")} />
      </Field>
      {general && <div className="notice bad" role="alert">{general}</div>}
      <WaitNote wait={wait} />
      <button className="btn" type="submit" disabled={isSubmitting || wait > 0}>{isSubmitting ? t("auth.sending") : t("auth.sendLink")}</button>
      <div className="hint"><Link href="/login">{t("auth.backToSignIn")}</Link></div>
    </form>
  );
}

// ---- reset

const resetSchema = (t: TFunction) =>
  z
    .object({ password: newPasswordRule(t), confirm: z.string() })
    .refine((v) => v.password === v.confirm, { path: ["confirm"], message: t("auth.errMismatch") });
type ResetValues = z.infer<ReturnType<typeof resetSchema>>;

export function ResetForm({ token }: { token: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [done, setDone] = useState(false);
  const wait = useThrottleWait();
  const [general, setGeneral] = useState("");
  const schema = useMemo(() => resetSchema(t), [t]);
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<ResetValues>({ resolver: zodResolver(schema) });

  if (done) {
    return (
      <div className="pane">
        <div className="notice" role="status"><div className="grow"><b>{t("auth.passwordChanged")}</b>{t("auth.passwordChangedText")}</div></div>
        <button className="btn" type="button" onClick={() => router.replace("/login")}>{t("auth.goToSignIn")}</button>
      </div>
    );
  }
  return (
    <form
      className="pane"
      noValidate
      onSubmit={handleSubmit(async (v) => {
        setGeneral("");
        try {
          await api.reset(token, v.password);
          setDone(true);
        } catch (e) {
          if (e instanceof ApiError && (e.code === "invite_invalid" || e.code === "not_found" || e.field("token"))) {
            setGeneral(t("auth.resetExpired"));
          } else showApiError(e, setError, setGeneral, t);
        }
      })}
    >
      <Field label={t("auth.newPassword")} error={errors.password?.message}>
        <input type="password" autoComplete="new-password" aria-invalid={!!errors.password} {...register("password")} />
      </Field>
      <Field label={t("auth.repeatPassword")} error={errors.confirm?.message}>
        <input type="password" autoComplete="new-password" aria-invalid={!!errors.confirm} {...register("confirm")} />
      </Field>
      {general && (
        <div className="notice bad" role="alert">
          <div className="grow">{general} <Link href="/forgot">{t("auth.requestNewLink")}</Link></div>
        </div>
      )}
      <WaitNote wait={wait} />
      <button className="btn" type="submit" disabled={isSubmitting || wait > 0}>{isSubmitting ? t("common.saving") : t("auth.changePassword")}</button>
    </form>
  );
}

// ---- accept invite

const joinSchema = (t: TFunction) =>
  z.object({
    full_name: z.string().trim().optional(),
    password: z.string().optional().refine((v) => !v || v.length >= 8, t("auth.errPasswordMin")),
  });
type JoinValues = z.infer<ReturnType<typeof joinSchema>>;

export function JoinForm({ token, email: invitedEmail, fullName, workspaceName }: { token: string; email: string; fullName: string; workspaceName: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const wait = useThrottleWait();
  const [general, setGeneral] = useState("");
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const schema = useMemo(() => joinSchema(t), [t]);
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<JoinValues>({
    resolver: zodResolver(schema),
    defaultValues: { full_name: fullName, password: "" },
  });

  if (mfaToken) return <MfaStep token={mfaToken} onDone={() => { router.replace("/app"); router.refresh(); }} onBack={() => setMfaToken(null)} />;

  return (
    <form
      className="pane"
      noValidate
      onSubmit={handleSubmit(async (v) => {
        setGeneral("");
        try {
          const r = await api.acceptInvite(token, { full_name: v.full_name || undefined, password: v.password || undefined });
          if (isMfaChallenge(r)) {
            setMfaToken(r.mfa_token);
            return;
          }
          router.replace("/app");
          router.refresh();
        } catch (e) {
          if (e instanceof ApiError && e.code === "invite_invalid") setGeneral(t("auth.inviteInvalid"));
          else showApiError(e, setError, setGeneral, t);
        }
      })}
    >
      <div className="notice">
        <div className="grow"><b dir="auto">{workspaceName}</b>{t("auth.joinFor", { email: invitedEmail })}</div>
      </div>
      <Field label={t("auth.yourName")} error={errors.full_name?.message}>
        <input autoComplete="name" dir="auto" {...register("full_name")} />
      </Field>
      <Field label={t("auth.choosePassword")} error={errors.password?.message}>
        <input type="password" autoComplete="new-password" aria-invalid={!!errors.password} {...register("password")} />
      </Field>
      <div className="hint">{t("auth.joinExistingHint")}</div>
      {general && <div className="notice bad" role="alert">{general}</div>}
      <WaitNote wait={wait} />
      <button className="btn" type="submit" disabled={isSubmitting || wait > 0}>{isSubmitting ? t("auth.joining") : t("auth.joinTeam")}</button>
      <GoogleButton
        divider
        onUnavailable={setGeneral}
        onCredential={async (credential) => {
          setGeneral("");
          try {
            const r = await authApi.acceptInviteGoogle(token, credential);
            if (isMfaChallenge(r)) {
              setMfaToken(r.mfa_token);
              return;
            }
            router.replace("/app");
            router.refresh();
          } catch (e) {
            if (e instanceof ApiError && e.code === "invite_invalid") setGeneral(t("auth.inviteInvalid"));
            else setGeneral(e instanceof ApiError ? googleErrorText(e.code, apiErrorText(e, t), t) : t("auth.generic"));
          }
        }}
      />
    </form>
  );
}
