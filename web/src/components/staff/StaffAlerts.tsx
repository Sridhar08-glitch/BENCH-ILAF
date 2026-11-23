"use client";

// Support alerts in the staff frame: the bell with its list, the count next to Support in the menu, the count in the tab title
// and an optional soft sound when a live chat starts waiting.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/Icon";
import { useI18n } from "@/lib/i18n/client";
import { sa } from "@/lib/staff-admin/api";
import { COUNTS_KEY, type StaffCounts } from "@/lib/staff-admin/frame";
import {
  ALERTS_KEY, ALERT_MIN_GAP_MS, ALERT_VISIBLE_MS, alertBadge, alertHref, alertInterval, alertKindKey, alertsApi, chatsIncreased, onSupportPage, playBeep, primeSound,
  readSoundPref, stripCountPrefix, titleWithCount, writeSoundPref, type AlertsData,
} from "@/lib/staffAlerts";
import s from "./StaffAlerts.module.css";

/** Asks the server for the alerts: every 20 s while the tab is visible, every 60 s while hidden, slower after failures. Off until the person is verified. */
export function useStaffAlerts(enabled: boolean): AlertsData | undefined {
  const qc = useQueryClient();
  const pathname = usePathname();
  const query = useQuery({
    queryKey: ALERTS_KEY,
    queryFn: alertsApi.get,
    enabled,
    retry: false,
    staleTime: ALERT_VISIBLE_MS / 2,
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: true,
    refetchInterval: (q) => alertInterval(typeof document !== "undefined" && document.hidden, q.state.errorUpdateCount),
  });
  // Moving between pages, and anything done to a request or the inbox (a reply, a status change), asks again at once so the count does not lag.
  const refresh = () => {
    const at = qc.getQueryState(ALERTS_KEY)?.dataUpdatedAt ?? 0;
    if (enabled && Date.now() - at > ALERT_MIN_GAP_MS) void qc.invalidateQueries({ queryKey: ALERTS_KEY });
  };
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => refreshRef.current(), [pathname]);
  useEffect(
    () =>
      qc.getQueryCache().subscribe((event) => {
        const head = event.query.queryKey[0];
        if (event.type === "updated" && event.action.type === "success" && (head === "staff-ticket" || head === "staff-inbox")) refreshRef.current();
      }),
    [qc],
  );
  const data = enabled ? query.data : undefined;
  useTabTitle(data?.total ?? 0, enabled);
  return data;
}

/** The counts next to Abuse and Data requests in the menu: two cheap numbers, asked for on the same rhythm as the alerts. Off until the person is verified. */
export function useStaffCounts(enabled: boolean): StaffCounts | undefined {
  const qc = useQueryClient();
  const pathname = usePathname();
  const query = useQuery({
    queryKey: COUNTS_KEY,
    queryFn: sa.counts,
    enabled,
    retry: false,
    staleTime: ALERT_VISIBLE_MS / 2,
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: true,
    refetchInterval: (q) => alertInterval(typeof document !== "undefined" && document.hidden, q.state.errorUpdateCount),
  });
  // A page change asks again (a report just dealt with should drop off the count), but not more often than every few seconds.
  useEffect(() => {
    const at = qc.getQueryState(COUNTS_KEY)?.dataUpdatedAt ?? 0;
    if (enabled && Date.now() - at > ALERT_MIN_GAP_MS) void qc.invalidateQueries({ queryKey: COUNTS_KEY });
  }, [pathname, enabled, qc]);
  return enabled ? query.data : undefined;
}

/** The count in front of the page title while the tab is hidden or the person is away from the Support pages. Page titles are left as they are. */
function useTabTitle(total: number, enabled: boolean) {
  const pathname = usePathname();
  const onSupport = onSupportPage(pathname);
  useEffect(() => {
    if (!enabled) return;
    const apply = () => {
      const want = titleWithCount(document.title, total, document.hidden, onSupport);
      if (document.title !== want) document.title = want;
    };
    apply();
    // A page change sets a new title: the count is put back in front of it.
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    document.addEventListener("visibilitychange", apply);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", apply);
      document.title = stripCountPrefix(document.title);
    };
  }, [total, onSupport, enabled]);
}

export function StaffBell({ data }: { data: AlertsData | undefined }) {
  const { t, number, relative } = useI18n();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [sound, setSound] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const lastChats = useRef<number | undefined>(undefined);
  const total = data?.total ?? 0;
  const badge = alertBadge(total);

  useEffect(() => setSound(readSoundPref()), []);
  useEffect(() => setOpen(false), [pathname]);

  const chats = data?.chats_waiting;
  useEffect(() => {
    if (chats === undefined) return;
    if (sound && chatsIncreased(lastChats.current, chats)) playBeep();
    lastChats.current = chats;
  }, [chats, sound]);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => wrap.current && !wrap.current.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  function toggleSound(on: boolean) {
    setSound(on);
    writeSoundPref(on);
    if (on) primeSound();
  }

  const label = badge ? t("staff.alerts.labelCount", { n: total }) : t("staff.alerts.label");
  const items = data?.latest ?? [];
  return (
    <div className={s.wrap} ref={wrap} data-testid="staff-bell">
      <button ref={button} type="button" className={`btn ghost sm ${s.btn}`} aria-haspopup="dialog" aria-expanded={open} aria-label={label} onClick={() => setOpen((o) => !o)}>
        <Icon name="bell" size="s" />
        {badge && <span className={s.badge} aria-hidden="true" data-testid="staff-bell-count">{number(badge.value)}{badge.over ? "+" : ""}</span>}
      </button>
      <span className="sr-only" role="status">{badge ? label : ""}</span>
      {open && (
        <div className={s.pop} role="dialog" aria-label={t("staff.alerts.title")}>
          <b className={s.head}>{t("staff.alerts.title")}</b>
          {items.length === 0 ? (
            <p className={s.empty}>{t("staff.alerts.empty")}</p>
          ) : (
            <ul className={s.list}>
              {items.map((a) => (
                <li key={`${a.kind}-${a.id}`}>
                  <Link href={alertHref(a)} className={s.item} onClick={() => setOpen(false)}>
                    <span className={s.dot} aria-hidden="true"><Icon name={a.kind === "chat" ? "chat" : "mail"} size="s" /></span>
                    <span className={s.text}>
                      <span className={s.kind}>{t(alertKindKey(a.kind))}</span>
                      <span className={s.name} dir="auto">{[a.label, a.requester_name].filter(Boolean).join(" · ")}</span>
                      {a.subject && <span className={s.subject} dir="auto">{a.subject}</span>}
                      <span className={s.meta}>{relative(a.created_at)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <label className={s.sound}>
            <input type="checkbox" checked={sound} onChange={(e) => toggleSound(e.target.checked)} data-testid="staff-bell-sound" />
            <span>{t("staff.alerts.sound")}</span>
          </label>
          <Link href="/staff/support" className={s.all} onClick={() => setOpen(false)}>{t("staff.alerts.open")}</Link>
        </div>
      )}
    </div>
  );
}

/** The count next to a menu item: beside the name in the sidebar and the More panel, over the icon in the phone bar. */
export function NavBadge({ total, place }: { total: number | undefined; place: "side" | "bar" }) {
  const { t, number } = useI18n();
  const badge = alertBadge(total);
  if (!badge) return null;
  return (
    <>
      <span className={place === "bar" ? s.navBar : s.navSide} aria-hidden="true" data-testid="staff-support-badge">{number(badge.value)}{badge.over ? "+" : ""}</span>
      <span className="sr-only">{t("staff.alerts.waiting", { n: total ?? 0 })}</span>
    </>
  );
}

/** The open count of a menu item (reports, data requests): the same badge as Support, with its own screen-reader text. */
export function CountBadge({ total, place, testId }: { total: number | undefined; place: "side" | "bar"; testId: string }) {
  const { t, number } = useI18n();
  const badge = alertBadge(total);
  if (!badge) return null;
  return (
    <>
      <span className={place === "bar" ? s.navBar : s.navSide} aria-hidden="true" data-testid={testId}>{number(badge.value)}{badge.over ? "+" : ""}</span>
      <span className="sr-only">{t("staff.count.open", { n: total ?? 0 })}</span>
    </>
  );
}
