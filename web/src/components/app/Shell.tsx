"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { designsApi } from "@/lib/designs/api";
import { Icon } from "@/components/Icon";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Logo, Lockup } from "@/components/Logo";
import { Avatar, ToastProvider, useToast } from "./ui";
import { ClosedBanner, ClosedPage, SuspendedPage } from "./ClosedCompany";
import { Announcements } from "./Announcements";
import { TwoFactorGate, TwoFactorNotice } from "./TwoFactor";
import { useFlags } from "@/lib/flags";
import { useThrottleWait } from "@/lib/throttle-hook";
import { useWs } from "./WorkspaceContext";
import { api } from "@/lib/api";
import { keys, useChangeRequests } from "@/lib/hooks";
import { APP_NAME } from "@/lib/config";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import { tk, type MessageKey } from "@/lib/i18n";
import { GuideRoot } from "@/components/guide/GuideRoot";
import { PwaRoot } from "@/components/app/PwaRoot";
import { clearOfflineData } from "@/lib/pwa/store";
import { HelpMenu } from "@/components/guide/HelpMenu";
import { LeadBell } from "./LeadBell";
import { ChatLauncher } from "@/components/support/ChatLauncher";
import { CountrySelect } from "./CountrySelect";
import { useSignOutGuard } from "./SignOutGuard";
import { useStaffShortcut } from "./useStaffShortcut";
import { NEW_COMPANY_EVENT } from "@/lib/guide/api";

interface NavItem {
  href: string;
  label: MessageKey;
  bar: MessageKey;
  icon: string;
  /** A small heading shown above this item in the sidebar, where a new group starts. */
  group?: MessageKey;
}

/** Navigation for the current role: employees only see their card, QR and contacts. */
function navFor(isManager: boolean, isCompany: boolean): NavItem[] {
  const base: NavItem[] = isManager
    ? [
        { href: "/app", label: tk("shell.navOverview"), bar: tk("shell.barHome"), icon: "home" },
        { href: "/app/cards", label: tk("shell.navCards"), bar: tk("shell.barCards"), icon: "card" },
        { href: "/app/qr", label: tk("shell.navQr"), bar: tk("shell.barQr"), icon: "qr" },
        { href: "/app/contacts", label: tk("shell.navContacts"), bar: tk("shell.barPeople"), icon: "users" },
        { href: "/app/analytics", label: tk("shell.navAnalytics"), bar: tk("shell.barStats"), icon: "chart" },
      ]
    : [
        { href: "/app/cards", label: tk("shell.navMyCard"), bar: tk("shell.barCard"), icon: "card" },
        { href: "/app/qr", label: tk("shell.navQr"), bar: tk("shell.barQr"), icon: "qr" },
        { href: "/app/contacts", label: tk("shell.navMyContacts"), bar: tk("shell.barPeople"), icon: "users" },
      ];
  // Tools for everyone: the e-mail signature, the video-call background and the paper-card scanner.
  base.push(
    { href: "/app/signature", label: tk("shell.navSignature"), bar: tk("shell.barSignature"), icon: "mail", group: tk("shell.groupTools") },
    { href: "/app/background", label: tk("shell.navBackground"), bar: tk("shell.barBackground"), icon: "camera" },
    { href: "/app/scan", label: tk("shell.navScan"), bar: tk("shell.barScan"), icon: "scan" },
    { href: "/app/nfc", label: tk("growth.navNfc"), bar: tk("growth.barNfc"), icon: "nfc" },
    { href: "/app/event", label: tk("growth.navEvent"), bar: tk("growth.barEvent"), icon: "pin" },
  );
  if (isManager && isCompany) {
    base.push(
      { href: "/app/team", label: tk("shell.navTeam"), bar: tk("shell.barTeam"), icon: "adduser", group: tk("shell.groupCompany") },
      { href: "/app/departments", label: tk("shell.navDepartments"), bar: tk("shell.barDepartments"), icon: "users" },
      { href: "/app/brand", label: tk("shell.navBrand"), bar: tk("shell.barBrand"), icon: "brand" },
      { href: "/app/requests", label: tk("designs.nav"), bar: tk("designs.navBar"), icon: "palette" },
      { href: "/app/fields", label: tk("shell.navFields"), bar: tk("shell.barFields"), icon: "lock" },
      { href: "/app/directory", label: tk("shell.navDirectory"), bar: tk("shell.barDirectory"), icon: "globe" },
      { href: "/app/activity", label: tk("shell.navActivity"), bar: tk("shell.barActivity"), icon: "clock" },
    );
  }
  if (isManager) base.push({ href: "/app/billing", label: tk("shell.navBilling"), bar: tk("shell.barPlan"), icon: "crown", group: tk("shell.groupAccount") });
  base.push({ href: "/app/settings", label: tk("shell.navSettings"), bar: tk("shell.barSettings"), icon: "settings", group: isManager ? undefined : tk("shell.groupAccount") });
  return base;
}

function isActive(pathname: string, href: string): boolean {
  return href === "/app" ? pathname === "/app" : pathname === href || pathname.startsWith(`${href}/`);
}

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <ShellInner>{children}</ShellInner>
    </ToastProvider>
  );
}

function ShellInner({ children }: { children: React.ReactNode }) {
  const { user, workspaces, current, setCurrent, isManager, isCompany, role, closed, closingDue, suspended } = useWs();
  const { t, locale } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const [more, setMore] = useState(false);
  const [creating, setCreating] = useState(false);
  const { guard, dialog: signOutDialog } = useSignOutGuard();
  const flags = useFlags(current.id);
  // A feature the product team switched off for this company has no menu entry.
  const nav = navFor(isManager, isCompany).filter((n) => (n.href !== "/app/directory" || flags.directory) && (n.href !== "/app/requests" || flags.custom_designs));
  const waiting = useChangeRequests(current.id, "pending", isManager && isCompany).data?.pending_count ?? 0;
  const designUnread = useQuery({ queryKey: ["design-requests-summary", current.id], queryFn: () => designsApi.summary(current.id), enabled: isManager && isCompany, refetchInterval: 60000 }).data;
  const designBadge = (designUnread?.unread ?? 0) + (designUnread?.in_review ?? 0);
  const moreRef = useRef<HTMLDivElement>(null);
  // Only a person with a staff role gets the shortcut; for everyone else this stays empty and nothing shows.
  const staff = useStaffShortcut();

  useEffect(() => setMore(false), [pathname]);

  // The getting-started checklist can ask for the "new company" form.
  useEffect(() => {
    const open = () => setCreating(true);
    window.addEventListener(NEW_COMPANY_EVENT, open);
    return () => window.removeEventListener(NEW_COMPANY_EVENT, open);
  }, []);

  // An employee has no business on manager-only screens; send them to their card.
  useEffect(() => {
    if (!isManager && (pathname === "/app" || /^\/app\/(analytics|team|brand|billing|departments|fields|directory|activity|requests)/.test(pathname))) router.replace("/app/cards");
  }, [isManager, pathname, router]);

  // The account's language wins over this device's cookie: when it was changed elsewhere, follow it.
  useEffect(() => {
    const saved = user.language;
    if (saved && saved !== locale) {
      document.cookie = `bench_lang=${saved}; path=/; max-age=31536000; samesite=lax`;
      router.refresh();
    }
  }, [user.language, locale, router]);

  // With unsent event notes on this device the person is asked first: signing out deletes them.
  const signOut = () => guard(doSignOut);
  async function doSignOut() {
    try {
      await api.logout();
    } finally {
      // The QR codes and screens this device kept for offline use belong to the account that just left.
      await clearOfflineData();
      qc.clear();
      window.location.assign("/login");
    }
  }

  const sub = current.subscription;
  // The preview tab is a card page on its own, without the sidebar.
  if (pathname.startsWith("/app/preview/")) return <>{children}</>;
  const barItems = nav.length <= 5 ? nav : nav.slice(0, 4);
  const moreItems = nav.length <= 5 ? [] : nav.slice(4);

  return (
    <div className="app">
      <aside className="side" aria-label={t("shell.sidebar")}>
        <Logo href="/app" />
        <div>
          <div className="grp">{current.kind === "company" ? current.name : t("shell.workspace")}</div>
          <nav className="nav" aria-label={t("shell.mainNav")}>
            {nav.map((n) => (
              <Fragment key={n.href}>
                {n.group && <div className="grp" style={{ marginBlockStart: 14, marginBlockEnd: 4 }}>{t(n.group)}</div>}
                <Link href={n.href} aria-current={isActive(pathname, n.href) ? "page" : undefined}>
                  <Icon name={n.icon} />
                  {t(n.label)}
                  {n.href === "/app/requests" && designBadge > 0 && <span className="count" aria-label={t("designs.badge", { n: designBadge })}>{designBadge}</span>}
                  {n.href === "/app/fields" && waiting > 0 && <span className="count" aria-label={t("shell.changesWaiting", { n: waiting })}>{waiting}</span>}
                </Link>
              </Fragment>
            ))}
          </nav>
        </div>
        {isManager && !sub.live && (
          <div className="upsell">
            <b><Icon name="crown" />{sub.status === "expired" ? t("shell.upsellEnded") : t("shell.upsellPick")}</b>
            <p>{sub.status === "expired" ? t("shell.upsellEndedText") : t("shell.upsellPickText")}</p>
            <Link className="btn sm block" href="/app/billing">{t("shell.seePlans")}</Link>
          </div>
        )}
        {staff && (
          <nav className="nav" aria-label={t("shell.staffLink")}>
            <Link href={staff.href} data-testid="staff-link">
              <Icon name="shield" />
              {t("shell.staffLink")}
              <small style={{ marginInlineStart: "auto", color: "var(--muted)", fontWeight: 500 }}>{t(staff.roleKey)}</small>
            </Link>
          </nav>
        )}
        <div className="who">
          <Avatar name={user.full_name} url={user.photo_url} />
          <div>
            <b dir="auto">{user.full_name}</b>
            <small>{role === "employee" ? t("shell.roleEmployee") : role === "admin" ? t("shell.roleAdmin") : t("shell.roleOwner")}</small>
          </div>
          <button type="button" className="x" aria-label={t("shell.signOut")} title={t("shell.signOut")} onClick={signOut} style={{ marginInlineStart: "auto" }}>
            <Icon name="logout" size="s" className="flip-rtl" />
          </button>
        </div>
        <LanguageSwitcher signedIn className="langpick side-lang" />
        <div className="sidefoot"><Lockup /></div>
      </aside>

      <main className="main">
        <header className="topbar">
          <Logo href="/app" compact />
          <div className="pick">
            <Icon name="card" />
            <select
              aria-label={t("shell.workspacePick")}
              value={current.id}
              onChange={(e) => {
                if (e.target.value === "__new") setCreating(true);
                else setCurrent(e.target.value);
              }}
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.kind === "personal" ? t("shell.personal") : w.name}
                </option>
              ))}
              <option value="__new">{t("shell.newCompanyOption")}</option>
            </select>
          </div>
          <LanguageSwitcher signedIn className="langpick top-lang" />
          <LeadBell />
          <HelpMenu />
          {isManager && !sub.live && <Link className="pill warn" href="/app/billing">{sub.status === "expired" ? t("shell.pillEnded") : t("shell.pillNone")}</Link>}
        </header>

        <SubscriptionBanner />
        <ThrottleNote />
        <Announcements />
        <TwoFactorNotice />
        {suspended ? <SuspendedPage /> : closed ? <ClosedPage /> : (
          <>
            {closingDue && <ClosedBanner due={closingDue} />}
            <TwoFactorGate>{children}</TwoFactorGate>
          </>
        )}
      </main>

      <nav className="bar" aria-label={t("shell.mainNav")}>
        {barItems.map((n) => (
          <Link key={n.href} href={n.href} aria-current={isActive(pathname, n.href) ? "page" : undefined}>
            <Icon name={n.icon} />
            {t(n.bar)}
          </Link>
        ))}
        {moreItems.length > 0 && (
          <button type="button" aria-expanded={more} aria-label={t("shell.more")} onClick={() => setMore((m) => !m)}>
            <Icon name="menu" />
            {t("shell.more")}
          </button>
        )}
        {moreItems.length === 0 && (
          <button type="button" aria-label={t("shell.signOut")} onClick={signOut}>
            <Icon name="logout" className="flip-rtl" />
            {t("shell.out")}
          </button>
        )}
      </nav>
      {more && (
        <div className="morepanel" ref={moreRef}>
          {moreItems.map((n) => (
            <Link key={n.href} href={n.href}><Icon name={n.icon} />{t(n.label)}</Link>
          ))}
          {staff && <Link href={staff.href} data-testid="staff-link-more"><Icon name="shield" />{t("shell.staffLink")} · {t(staff.roleKey)}</Link>}
          <button type="button" onClick={signOut}><Icon name="logout" className="flip-rtl" />{t("shell.signOut")}</button>
        </div>
      )}

      <GuideRoot />
      {flags.support_chat && <ChatLauncher workspaceId={current.id} />}
      {signOutDialog}
      <PwaRoot />

      {creating && (
        <NewCompany
          onClose={() => setCreating(false)}
          onCreated={async (id) => {
            await qc.invalidateQueries({ queryKey: keys.workspaces });
            setCurrent(id);
            setCreating(false);
            toast(t("shell.companyCreated", { app: APP_NAME }));
            router.push("/app/billing");
          }}
        />
      )}
    </div>
  );
}

/** While the API asks us to slow down, say so and for how long (changes are held back by the client until then). */
function ThrottleNote() {
  const { t } = useI18n();
  const n = useThrottleWait();
  if (n <= 0) return null;
  return (
    <div className="notice warn" role="status" aria-live="polite">
      <Icon name="clock" />
      <div className="grow">{t("shell.throttleNote", { n })}</div>
    </div>
  );
}

/** Tells owners when the plan is missing or ended, and that cards stay online during the grace period. */
function SubscriptionBanner() {
  const { current, isManager } = useWs();
  const { t, date } = useI18n();
  const sub = current.subscription;
  if (!isManager) return null;
  const fmt = (d: string | null) => (d ? date(d) : "");
  if (sub.status === "expired") {
    return (
      <div className={`notice ${sub.live ? "warn" : "bad"}`} role="status">
        <Icon name="alert" />
        <div className="grow">
          <b>{sub.live ? t("shell.bannerEndedTitle") : t("shell.bannerOfflineTitle")}</b>
          {sub.live
            ? t("shell.bannerEndedText", { date: fmt(sub.grace_ends_at) })
            : t("shell.bannerOfflineText")}
          <div style={{ marginBlockStart: 8 }}><Link className="btn sm" href="/app/billing">{t("shell.renewPlan")}</Link></div>
        </div>
      </div>
    );
  }
  if (sub.status === "none") {
    return (
      <div className="notice" role="status">
        <Icon name="crown" />
        <div className="grow">
          <b>{t("shell.bannerNoneTitle")}</b>
          {t("shell.bannerNoneText")}
          <div style={{ marginBlockStart: 8 }}><Link className="btn sm" href="/app/billing">{t("shell.seePlans")}</Link></div>
        </div>
      </div>
    );
  }
  return null;
}

function NewCompany({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [country, setCountry] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) return setErr(t("shell.enterCompanyName"));
    setBusy(true);
    try {
      const w = await api.createWorkspace(name.trim(), country || undefined);
      onCreated(w.id);
    } catch (e2) {
      setErr(apiErrorText(e2, t, "shell.createFailed"));
      setBusy(false);
    }
  }
  return (
    <div className="sheet fixed" style={{ justifyContent: "center", alignItems: "center", padding: 16 }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="panel card" style={{ width: "100%", maxWidth: 420 }} onSubmit={submit} role="dialog" aria-modal="true" aria-label={t("shell.newCompanyTitle")}>
        <h2>{t("shell.newCompanyTitle")}</h2>
        <p className="sub" style={{ marginBlockStart: 0 }}>{t("shell.newCompanyText")}</p>
        <label>
          {t("shell.companyName")}
          <input ref={input} value={name} onChange={(e) => setName(e.target.value)} dir="auto" />
        </label>
        <CountrySelect value={country} onChange={setCountry} />
        {err && <span className="err" role="alert">{err}</span>}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn ghost" onClick={onClose}>{t("common.cancel")}</button>
          <button type="submit" className="btn" disabled={busy}>{busy ? t("shell.creating") : t("shell.create")}</button>
        </div>
      </form>
    </div>
  );
}
