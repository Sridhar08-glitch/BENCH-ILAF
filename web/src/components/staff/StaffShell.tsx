"use client";

// The staff area's frame: the same sidebar, top bar and phone bar as the customer workspace, with the two-step gate in front of every screen.
// Nothing in the customer app links here; a person without a staff role sees a plain "not found".
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/Icon";
import { Providers } from "@/components/app/Providers";
import { QrPreview, ToastProvider } from "@/components/app/ui";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Lockup, Logo } from "@/components/Logo";
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
  const [more, setMore] = useState(false);
  const me = useQuery({ queryKey: ["staff-me"], queryFn: staffApi.me, retry: false });
  useEffect(() => setMore(false), [pathname]);
  if (me.isLoading) return <div className="panel" style={{ margin: 40, padding: 24 }} role="status">{t("staff.loading")}</div>;
  // not signed in is handled by the middleware; any other refusal means "this is not for you"
  if (me.error || !me.data) {
    const notStaff = me.error instanceof ApiError && me.error.status === 404;
    return <div style={{ padding: "20vh 20px", textAlign: "center" }}><h1>{notStaff ? "404" : t("staff.cannotLoad")}</h1><p className="sub">{notStaff ? t("staff.notFound") : errorText(me.error, t)}</p></div>;
  }
  const staff = me.data;
  const under = (h: string) => pathname === h || pathname.startsWith(`${h}/`);
  const active = (h: string) => (h === "/staff/design-requests" ? under(h) || under("/staff/requests") || under("/staff/faces") : h === "/staff/support" ? under(h) && !under("/staff/support/settings") : under(h));
  const adminNav = navFor(staff.staff_role);
  const items: MenuItem[] = [
    ...adminNav.map((n, i) => ({
      href: n.href,
      label: n.label,
      icon: n.icon,
      on: n.href === "/staff" ? pathname === "/staff" : under(n.href),
      group: (i === 0 || adminNav[i - 1].group !== n.group) && n.group !== "Overview" ? n.group : undefined,
    })),
    ...NAV.map((n, i) => ({ href: n.href, label: t(n.label), icon: n.icon, on: active(n.href), group: i === 0 ? t("staff.menu") : undefined })),
  ];
  const barItems = items.slice(0, 4);
  const moreItems = items.slice(4);
  const endSession = async () => {
    try { await staffApi.logout(); } catch { /* already ended */ }
    staffToken.clear();
    void qc.invalidateQueries({ queryKey: ["staff-me"] });
  };
  const role = t(ROLE_KEYS[staff.staff_role]);
  return (
    <div className="app">
      <aside className="side" aria-label={t("staff.sidebar")}>
        <Logo href="/staff" />
        <div>
          <div className="grp" title={t("staff.strip")}>{t("staff.area")}</div>
          <nav className="nav" aria-label={t("staff.menu")}>
            {items.map((n) => (
              <Fragment key={n.href}>
                {n.group && <div className="grp" style={{ marginBlockStart: 14, marginBlockEnd: 4 }}>{n.group}</div>}
                <Link href={n.href} aria-current={n.on ? "page" : undefined}>
                  <Icon name={n.icon} />
                  {n.label}
                </Link>
              </Fragment>
            ))}
          </nav>
        </div>
        <div className="who" style={{ marginBlockStart: "auto" }}>
          <div>
            <b dir="auto">{staff.email}</b>
            <small>{role}</small>
          </div>
          {staff.verified && (
            <button type="button" className="x" aria-label={t("staff.endSession")} title={t("staff.endSession")} onClick={() => void endSession()} style={{ marginInlineStart: "auto" }}>
              <Icon name="logout" size="s" className="flip-rtl" />
            </button>
          )}
        </div>
        <LanguageSwitcher className="langpick side-lang" />
        <div className="sidefoot"><Lockup /></div>
      </aside>

      <main className="main staffpages">
        <header className="topbar">
          <Logo href="/staff" compact />
          <div className="pick"><span className="pill dark" title={t("staff.strip")}>{t("staff.area")}</span></div>
          <LanguageSwitcher className="langpick top-lang" />
        </header>
        <SupportBanner />
        {staff.verified ? children : <Gate me={staff} onDone={() => void qc.invalidateQueries({ queryKey: ["staff-me"] })} />}
      </main>

      <nav className="bar" aria-label={t("staff.menu")}>
        {barItems.map((n) => (
          <Link key={n.href} href={n.href} aria-current={n.on ? "page" : undefined}>
            <Icon name={n.icon} />
            {n.label}
          </Link>
        ))}
        <button type="button" aria-expanded={more} aria-label={t("staff.more")} onClick={() => setMore((m) => !m)}>
          <Icon name="menu" />
          {t("staff.more")}
        </button>
      </nav>
      {more && (
        <div className="morepanel">
          {moreItems.map((n) => (
            <Link key={n.href} href={n.href}><Icon name={n.icon} />{n.label}</Link>
          ))}
          {staff.verified && <button type="button" onClick={() => void endSession()}><Icon name="logout" className="flip-rtl" />{t("staff.endSession")}</button>}
        </div>
      )}
    </div>
  );
}

interface MenuItem { href: string; label: string; icon: string; on: boolean; group?: string }

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
