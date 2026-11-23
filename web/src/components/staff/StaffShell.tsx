"use client";

// The staff area's frame: an ink strip on top ("Staff only"), a left menu, and the two-step gate in front of every screen.
// Nothing in the customer app links here; a person without a staff role sees a plain "not found".
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/Icon";
import { Providers } from "@/components/app/Providers";
import { QrPreview, ToastProvider } from "@/components/app/ui";
import { Wordmark } from "@/components/Logo";
import { ApiError } from "@/lib/api";
import { errorText, staffApi, staffToken, type StaffMe } from "@/lib/designs/api";
import { useI18n } from "@/lib/i18n/client";
import { tk, type MessageKey } from "@/lib/i18n";
import { SupportBanner } from "@/components/staff-admin/SupportView";
import { navFor } from "@/lib/staff-admin/roles";

const NAV: { href: string; label: MessageKey; icon: string }[] = [
  { href: "/staff/design-requests", label: tk("staff.navRequests"), icon: "palette" },
  { href: "/staff/support", label: tk("staff.navSupport"), icon: "chat" },
  { href: "/staff/support/settings", label: tk("staff.navSupportSettings"), icon: "settings" },
  { href: "/staff/security", label: tk("staff.navSecurity"), icon: "lock" },
];

export function StaffShell({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <ToastProvider>
        <Frame>{children}</Frame>
      </ToastProvider>
    </Providers>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["staff-me"], queryFn: staffApi.me, retry: false });
  if (me.isLoading) return <div style={{ padding: 40 }} role="status">{t("staff.loading")}</div>;
  // not signed in is handled by the middleware; any other refusal means "this is not for you"
  if (me.error || !me.data) {
    const notStaff = me.error instanceof ApiError && me.error.status === 404;
    return <div style={{ padding: "20vh 20px", textAlign: "center" }}><h1>{notStaff ? "404" : t("staff.cannotLoad")}</h1><p className="sub">{notStaff ? t("staff.notFound") : errorText(me.error, t)}</p></div>;
  }
  const staff = me.data;
  const under = (h: string) => pathname === h || pathname.startsWith(`${h}/`);
  const active = (h: string) => (h === "/staff/design-requests" ? under(h) || under("/staff/requests") || under("/staff/faces") : h === "/staff/support" ? under(h) && !under("/staff/support/settings") : under(h));
  const adminNav = navFor(staff.staff_role);
  return (
    <div style={{ minHeight: "100vh", display: "grid", gridTemplateRows: "auto 1fr", background: "var(--surface-2)" }}>
      <div role="banner" style={{ background: "var(--ink)", color: "#fff", padding: "8px 18px", display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
        <Wordmark />
        <b>{t("staff.strip")}</b>
        <span className="grow" />
        <span style={{ color: "var(--inv-mute)" }}>{staff.email} · {t(ROLE_KEYS[staff.staff_role])}</span>
        {staff.verified && (
          <button type="button" className="btn ghost sm" onClick={async () => { try { await staffApi.logout(); } catch { /* already ended */ } staffToken.clear(); void qc.invalidateQueries({ queryKey: ["staff-me"] }); }}>{t("staff.endSession")}</button>
        )}
      </div>
      <SupportBanner />
      <div className="staffgrid">
        <nav aria-label={t("staff.menu")} className="staffnav">
          {adminNav.map((n, i) => (
            <div key={n.href} style={{ display: "contents" }}>
              {(i === 0 || adminNav[i - 1].group !== n.group) && n.group !== "Overview" && <span className="hint" style={{ padding: "10px 12px 2px", textTransform: "uppercase", letterSpacing: ".06em", fontSize: 11 }}>{n.group}</span>}
              <Link href={n.href} aria-current={(n.href === "/staff" ? pathname === "/staff" : under(n.href)) ? "page" : undefined} className={(n.href === "/staff" ? pathname === "/staff" : under(n.href)) ? "on" : ""}>
                <Icon name={n.icon} size="s" /> {n.label}
              </Link>
            </div>
          ))}
          <span className="hint" style={{ padding: "10px 12px 2px", textTransform: "uppercase", letterSpacing: ".06em", fontSize: 11 }}>{t("staff.menu")}</span>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={active(n.href) ? "page" : undefined} className={active(n.href) ? "on" : ""}>
              <Icon name={n.icon} size="s" /> {t(n.label)}
            </Link>
          ))}
        </nav>
        <main style={{ padding: 20, minWidth: 0 }}>
          {staff.verified ? children : <Gate me={staff} onDone={() => void qc.invalidateQueries({ queryKey: ["staff-me"] })} />}
        </main>
      </div>
      <style>{`.staffgrid{display:grid;grid-template-columns:200px 1fr}.staffnav{display:flex;flex-direction:column;gap:2px;padding:14px 10px;border-inline-end:1px solid var(--line);background:var(--surface)}.staffnav a{display:flex;gap:8px;align-items:center;padding:9px 12px;border-radius:10px;text-decoration:none;color:var(--mute)}.staffnav a.on{background:var(--ink);color:#fff}@media(max-width:760px){.staffgrid{grid-template-columns:1fr}.staffnav{flex-direction:row;overflow:auto;border-inline-end:0;border-bottom:1px solid var(--line)}}`}</style>
    </div>
  );
}

export const ROLE_KEYS: Record<StaffMe["staff_role"], MessageKey> = { read_only: tk("staff.roleReadOnly"), support: tk("staff.roleSupport"), admin: tk("staff.roleAdmin") };

/** The second step: enrol the authenticator app once, then enter a code (or a recovery code) for each 12 hour session. */
function Gate({ me, onDone }: { me: StaffMe; onDone: () => void }) {
  const { t } = useI18n();
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [err, setErr] = useState("");
  const [setup, setSetup] = useState<{ secret: string; otpauth_uri: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>) {
    setBusy(true); setErr("");
    try { await fn(); } catch (e) { setErr(errorText(e, t)); } finally { setBusy(false); }
  }
  if (codes) {
    return (
      <section className="panel" style={{ padding: 20, maxWidth: 520, display: "grid", gap: 10 }}>
        <h2>{t("staff.recoveryTitle")}</h2>
        <p className="sub">{t("staff.recoveryText")}</p>
        <pre className="mono" style={{ columns: 2, margin: 0 }}>{codes.join("\n")}</pre>
        <div><button className="btn" onClick={onDone}>{t("staff.recoverySaved")}</button></div>
      </section>
    );
  }
  if (!me.totp_enrolled) {
    return (
      <section className="panel" style={{ padding: 20, maxWidth: 520, display: "grid", gap: 12 }}>
        <h2>{t("staff.enrolTitle")}</h2>
        <p className="sub">{t("staff.enrolText")}</p>
        {!setup ? (
          <div><button className="btn" disabled={busy} onClick={() => void run(async () => setSetup(await staffApi.enrol()))}>{t("staff.enrolStart")}</button></div>
        ) : (
          <>
            <QrPreview text={setup.otpauth_uri} label={t("staff.qrLabel")} />
            <div className="hint">{t("staff.enrolSecret")}: <code>{setup.secret}</code></div>
            <form className="row" onSubmit={(e) => { e.preventDefault(); void run(async () => { const r = await staffApi.confirm(code); staffToken.set(r.token); setCodes(r.recovery_codes); }); }}>
              <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" aria-label={t("staff.codeLabel")} />
              <button className="btn" disabled={busy}>{t("staff.enrolConfirm")}</button>
            </form>
          </>
        )}
        {err && <div className="err" role="alert">{err}</div>}
      </section>
    );
  }
  return (
    <section className="panel" style={{ padding: 20, maxWidth: 420, display: "grid", gap: 12 }}>
      <h2>{t("staff.verifyTitle")}</h2>
      <p className="sub">{recovery ? t("staff.verifyRecoveryText") : t("staff.verifyText")}</p>
      <form className="row" onSubmit={(e) => { e.preventDefault(); void run(async () => { const r = await staffApi.verify(recovery ? { recovery_code: code } : { code }); staffToken.set(r.token); onDone(); }); }}>
        <input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" placeholder={recovery ? "xxxxx-xxxxx" : "123456"} aria-label={t("staff.codeLabel")} autoFocus />
        <button className="btn" disabled={busy}>{t("staff.verifyButton")}</button>
      </form>
      <button type="button" className="linkbtn" onClick={() => { setRecovery(!recovery); setCode(""); setErr(""); }}>{recovery ? t("staff.useApp") : t("staff.useRecovery")}</button>
      {err && <div className="err" role="alert">{err}</div>}
    </section>
  );
}
