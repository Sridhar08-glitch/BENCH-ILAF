"use client";

// Settings > Security (2-step verification) and Settings > Devices (signed-in devices and remembered browsers).
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/Icon";
import { ErrorBox, SkeletonBlocks, useToast } from "@/components/app/ui";
import { useWs } from "@/components/app/WorkspaceContext";
import { Dialog } from "@/components/ops/shared";
import { keys } from "@/lib/hooks";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import { tk, type MessageKey } from "@/lib/i18n";
import { devicesApi, twoFactorApi, type DeviceSession, type TwoFactorSetup, type TwoFactorStatus } from "@/lib/security-api";
import { cleanCode, groupSecret, otpauthIsSafe, recoveryFileText } from "@/lib/two-factor";
import { CANCELLED, useConfirmation, useReauth } from "./ReauthDialog";

const STATUS_KEY = ["two-factor"] as const;

/** The QR code of the otpauth address, drawn in the browser (the secret never leaves this page). */
function SetupQr({ uri }: { uri: string }) {
  const [src, setSrc] = useState("");
  const { t } = useI18n();
  useEffect(() => {
    let live = true;
    if (!otpauthIsSafe(uri)) return;
    import("qrcode")
      .then((q) => q.toDataURL(uri, { margin: 1, width: 192, errorCorrectionLevel: "M" }))
      .then((url) => live && setSrc(url))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [uri]);
  if (!src) return <div className="skeleton" style={{ width: 192, height: 192 }} />;
  return <img src={src} width={192} height={192} alt={t("security.qrAlt")} style={{ background: "#fff", borderRadius: 12, padding: 4 }} />;
}

/** The ten recovery codes, shown once, with copy and download. */
function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [saved, setSaved] = useState(false);
  const text = recoveryFileText(codes, t("security.recoveryFileNote"));
  return (
    <div className="pane">
      <div className="notice warn" role="status"><Icon name="alert" /><div className="grow"><b>{t("security.recoveryTitle")}</b>{t("security.recoveryText")}</div></div>
      <ul className="codes ltr" dir="ltr" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 6, fontFamily: "ui-monospace,monospace", fontSize: 15 }}>
        {codes.map((c) => <li key={c}>{c}</li>)}
      </ul>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn ghost sm" onClick={() => void navigator.clipboard?.writeText(codes.join("\n")).then(() => toast(t("security.copied")))}>{t("security.copyCodes")}</button>
        <a className="btn ghost sm" download="recovery-codes.txt" href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`}>{t("security.downloadCodes")}</a>
      </div>
      <label className="chkrow"><input className="chk" type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />{t("security.recoverySaved")}</label>
      <button type="button" className="btn" disabled={!saved} onClick={onDone}>{t("common.done")}</button>
    </div>
  );
}

function CodeField({ value, onChange, label, autoFocus }: { value: string; onChange: (v: string) => void; label: string; autoFocus?: boolean }) {
  return (
    <label>
      {label}
      <input className="ltr" dir="ltr" autoFocus={autoFocus} autoComplete="one-time-code" inputMode="numeric" maxLength={9} value={value} placeholder="123 456" onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/** Turn on: scan, enter the first code, save the recovery codes. */
function EnableFlow({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const reauth = useReauth();
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    reauth
      .run((proof) => twoFactorApi.setup(proof))
      .then((r) => {
        if (!live) return;
        if (r === CANCELLED) onClose();
        else setSetup(r);
      })
      .catch((e) => live && setErr(apiErrorText(e, t, "security.setupFailed")));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function confirm() {
    setErr("");
    setBusy(true);
    try {
      const r = await twoFactorApi.confirm(cleanCode(code));
      setCodes(r.recovery_codes);
      void qc.invalidateQueries({ queryKey: STATUS_KEY });
      void qc.invalidateQueries({ queryKey: keys.me });
    } catch (e) {
      setErr(apiErrorText(e, t, "security.stepFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={t("security.enableTitle")} onClose={onClose} wide>
      {codes ? (
        <RecoveryCodes codes={codes} onDone={onClose} />
      ) : (
        <div className="pane">
          {!setup && !err && <SkeletonBlocks rows={2} />}
          {setup && (
            <>
              <ol className="steps" style={{ margin: 0, paddingInlineStart: 20, display: "grid", gap: 6 }}>
                <li>{t("security.enableStep1")}</li>
                <li>{t("security.enableStep2")}</li>
                <li>{t("security.enableStep3")}</li>
              </ol>
              <div className="row" style={{ gap: 16, flexWrap: "wrap", alignItems: "center" }}>
                <SetupQr uri={setup.otpauth_uri} />
                <div className="pane" style={{ gap: 4, minWidth: 0 }}>
                  <span className="sechead">{t("security.cantScan")}</span>
                  <code className="ltr" dir="ltr" style={{ overflowWrap: "anywhere", fontSize: 14 }}>{groupSecret(setup.secret)}</code>
                  <span className="hint">{t("security.secretHint", { account: setup.account })}</span>
                </div>
              </div>
              <CodeField label={t("security.firstCode")} value={code} onChange={setCode} autoFocus />
              <button type="button" className="btn" disabled={cleanCode(code).length !== 6 || busy} onClick={() => void confirm()}>{busy ? t("security.checking") : t("security.turnOn")}</button>
            </>
          )}
          {err && <span className="err" role="alert">{err}</span>}
        </div>
      )}
      {reauth.dialog}
    </Dialog>
  );
}

/** Turn off: password (or Google) plus a code. */
function DisableFlow({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const confirmation = useConfirmation();
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setErr("");
    setBusy(true);
    try {
      await twoFactorApi.disable({ ...confirmation.proof, ...(recovery ? { recovery_code: code.replace(/[\s-]/g, "") } : { code: cleanCode(code) }) });
      void qc.invalidateQueries({ queryKey: STATUS_KEY });
      void qc.invalidateQueries({ queryKey: keys.me });
      toast(t("security.turnedOff"));
      onClose();
    } catch (e) {
      setErr(apiErrorText(e, t, "security.stepFailed"));
      setBusy(false);
    }
  }

  const ready = confirmation.ready && (recovery ? code.replace(/[\s-]/g, "").length >= 10 : cleanCode(code).length === 6);
  return (
    <Dialog
      title={t("security.disableTitle")}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose}>{t("common.cancel")}</button>
          <button type="button" className="btn" disabled={!ready || busy} onClick={() => void submit()}>{t("security.turnOff")}</button>
        </>
      }
    >
      <div className="notice warn" role="note"><Icon name="alert" /><div className="grow">{t("security.disableText")}</div></div>
      {confirmation.field}
      <label>
        {recovery ? t("security.recoveryCode") : t("security.authCode")}
        <input className="ltr" dir="ltr" autoComplete="one-time-code" inputMode={recovery ? "text" : "numeric"} value={code} onChange={(e) => setCode(e.target.value)} />
      </label>
      <button type="button" className="linkbtn" style={{ alignSelf: "flex-start" }} onClick={() => { setRecovery(!recovery); setCode(""); }}>
        {recovery ? t("security.useAuthApp") : t("security.useRecovery")}
      </button>
      {err && <span className="err" role="alert">{err}</span>}
    </Dialog>
  );
}

/** New recovery codes (the old ones stop working). */
function RegenerateFlow({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title={t("security.newCodesTitle")} onClose={onClose}>
      {codes ? (
        <RecoveryCodes codes={codes} onDone={onClose} />
      ) : (
        <div className="pane">
          <div className="hint">{t("security.newCodesText")}</div>
          <CodeField label={t("security.authCode")} value={code} onChange={setCode} autoFocus />
          {err && <span className="err" role="alert">{err}</span>}
          <button
            type="button"
            className="btn"
            disabled={cleanCode(code).length !== 6 || busy}
            onClick={async () => {
              setErr("");
              setBusy(true);
              try {
                const r = await twoFactorApi.newRecoveryCodes(cleanCode(code));
                setCodes(r.recovery_codes);
                void qc.invalidateQueries({ queryKey: STATUS_KEY });
              } catch (e) {
                setErr(apiErrorText(e, t, "security.stepFailed"));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("security.makeNewCodes")}
          </button>
        </div>
      )}
    </Dialog>
  );
}

export function TwoFactorPanel() {
  const { t, number, date } = useI18n();
  const status = useQuery({ queryKey: STATUS_KEY, queryFn: twoFactorApi.status });
  const [flow, setFlow] = useState<"enable" | "disable" | "codes" | null>(null);
  const s: TwoFactorStatus | undefined = status.data;
  const required = s?.required;
  return (
    <section className="panel card" aria-labelledby="2fa-h">
      <div className="head"><h2 id="2fa-h"><span className="chip"><Icon name="lock" size="s" /></span>{t("security.twoFactorTitle")}</h2></div>
      {status.isLoading ? <SkeletonBlocks rows={2} /> : status.error ? <ErrorBox error={status.error} onRetry={() => void status.refetch()} /> : s && (
        <>
          {s.enabled ? (
            <div className="notice" role="status"><Icon name="check" /><div className="grow"><b>{t("security.on")}</b>{t("security.onText", { n: number(s.recovery_codes_left) })}</div></div>
          ) : (
            <div className="hint">{t("security.offText")}</div>
          )}
          {!s.enabled && required && (
            <div className={`notice ${required.enforced ? "bad" : "warn"}`} role="status">
              <Icon name="alert" />
              <div className="grow">{required.enforced ? t("security.requiredNow", { company: required.workspace_name }) : t("security.requiredSoon", { company: required.workspace_name, date: date(required.deadline) })}</div>
            </div>
          )}
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            {s.enabled ? (
              <>
                <button type="button" className="btn ghost" onClick={() => setFlow("codes")}>{t("security.newCodes")}</button>
                <button type="button" className="btn ghost" onClick={() => setFlow("disable")}>{t("security.turnOff")}</button>
              </>
            ) : (
              <button type="button" className="btn" onClick={() => setFlow("enable")}>{t("security.turnOn")}</button>
            )}
          </div>
        </>
      )}
      {flow === "enable" && <EnableFlow onClose={() => setFlow(null)} />}
      {flow === "disable" && <DisableFlow onClose={() => setFlow(null)} />}
      {flow === "codes" && <RegenerateFlow onClose={() => setFlow(null)} />}
    </section>
  );
}

// ---------------------------------------------------------------- devices
const DEVICES_KEY = ["devices"] as const;

/** The sentence of each account security event the server keeps. */
const EVENT_KEYS: Record<string, MessageKey> = {
  new_device: tk("security.eventNewDevice"), "2fa_on": tk("security.event2faOn"), "2fa_off": tk("security.event2faOff"),
  recovery_codes_renewed: tk("security.eventCodesRenewed"), recovery_used: tk("security.eventRecoveryUsed"),
  device_signed_out: tk("security.eventDeviceOut"), others_signed_out: tk("security.eventOthersOut"),
};

function DeviceIcon({ kind }: { kind: DeviceSession["kind"] }) {
  return <Icon name={kind === "phone" || kind === "tablet" ? "tap" : "card"} />;
}

export function DevicesPanel() {
  const { t, date } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useWs();
  const list = useQuery({ queryKey: DEVICES_KEY, queryFn: devicesApi.list });
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const data = list.data;
  const others = data ? data.sessions.filter((d) => !d.current) : [];
  const known = !!data?.current_session_id;

  async function run(id: string, fn: () => Promise<unknown>, done: string) {
    setErr("");
    setBusy(id);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: DEVICES_KEY });
      toast(done);
    } catch (e) {
      setErr(apiErrorText(e, t, "security.deviceFailed"));
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="panel card" aria-labelledby="dev-h">
      <div className="head"><h2 id="dev-h"><span className="chip"><Icon name="card" size="s" /></span>{t("security.devicesTitle")}</h2></div>
      <div className="hint">{t("security.devicesHint", { email: user.email })}</div>
      {list.isLoading ? <SkeletonBlocks rows={3} /> : list.error ? <ErrorBox error={list.error} onRetry={() => void list.refetch()} /> : data && (
        <>
          {!known && <div className="notice warn" role="status"><Icon name="alert" /><div className="grow">{t("security.signInAgain")}</div></div>}
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
            {data.sessions.map((d) => (
              <li key={d.id} className="irow" style={{ alignItems: "center" }}>
                <span className="chip"><DeviceIcon kind={d.kind} /></span>
                <div className="mid">
                  <b dir="auto">{d.label ?? t("security.unknownDevice")}{d.current && <span className="pill dark" style={{ marginInlineStart: 8 }}>{t("security.thisDevice")}</span>}</b>
                  <span className="mono" style={{ overflowWrap: "anywhere" }}>
                    {[d.ip, d.country].filter(Boolean).join(" · ")}
                  </span>
                  <span className="hint">{t("security.deviceTimes", { first: date(d.created_at), last: date(d.last_used_at) })}</span>
                </div>
                {!d.current && (
                  <button type="button" className="btn ghost sm" disabled={busy === d.id} onClick={() => void run(d.id, () => devicesApi.signOut(d.id), t("security.signedOutOne"))}>{t("security.signOutDevice")}</button>
                )}
              </li>
            ))}
          </ul>
          {others.length > 0 && known && (
            <div>
              <button type="button" className="btn ghost" disabled={busy === "all"} onClick={() => void run("all", () => devicesApi.signOutOthers(), t("security.signedOutOthers"))}>{t("security.signOutOthers")}</button>
            </div>
          )}
          {data.trusted_devices.length > 0 && (
            <div className="pane" style={{ gap: 6 }}>
              <span className="sechead">{t("security.rememberedTitle")}</span>
              <div className="hint">{t("security.rememberedHint")}</div>
              {data.trusted_devices.map((d) => (
                <div key={d.id} className="row" style={{ gap: 8, alignItems: "center" }}>
                  <span className="grow" dir="auto">{d.label ?? t("security.unknownDevice")} <span className="hint">{t("security.rememberedUntil", { date: date(d.expires_at) })}</span></span>
                  <button type="button" className="btn ghost sm" disabled={busy === d.id} onClick={() => void run(d.id, () => devicesApi.forgetTrusted(d.id), t("security.forgotten"))}>{t("security.forget")}</button>
                </div>
              ))}
            </div>
          )}
          {data.events.length > 0 && (
            <details>
              <summary>{t("security.recentActivity")}</summary>
              <ul style={{ margin: "8px 0 0", paddingInlineStart: 18, display: "grid", gap: 4 }}>
                {data.events.map((e, i) => (
                  <li key={i}>{EVENT_KEYS[e.action] ? t(EVENT_KEYS[e.action]) : e.action}{e.detail && e.action === "device_signed_out" ? ` (${e.detail})` : ""} <span className="hint">{date(e.created_at)}</span></li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      {err && <span className="err" role="alert">{err}</span>}
    </section>
  );
}
