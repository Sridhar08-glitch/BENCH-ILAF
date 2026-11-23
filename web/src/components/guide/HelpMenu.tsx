"use client";

// The Help button of the app shell: getting started, a tour of this page, the help centre and the welcome again.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { useWs } from "@/components/app/WorkspaceContext";
import { useI18n } from "@/lib/i18n/client";
import { TOUR_EVENT, WELCOME_EVENT } from "@/lib/guide/api";
import { CHECKLIST } from "@/lib/guide/engine";
import { tourFor } from "@/lib/guide/tours";
import { useSaveProgress } from "@/lib/guide/hooks";
import { useQuery } from "@tanstack/react-query";
import { supportApi } from "@/lib/support/api";
import s from "./guide.module.css";

export function HelpMenu() {
  const { t } = useI18n();
  const { isManager } = useWs();
  const pathname = usePathname();
  const router = useRouter();
  const save = useSaveProgress();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const hasTour = tourFor(pathname) !== null;
  // Replies waiting in support requests (checked once a minute).
  const unread = useQuery({ queryKey: ["support-summary"], queryFn: supportApi.summary, refetchInterval: 60_000, retry: false }).data?.unread ?? 0;

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => wrap.current && !wrap.current.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        wrap.current?.querySelector<HTMLElement>("button")?.focus();
      }
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  function start() {
    setOpen(false);
    // Bring the checklist back if it was hidden, then go where it is.
    save(CHECKLIST, "hidden", "reset");
    router.push(isManager ? "/app" : "/app/cards");
  }

  return (
    <div className={s.menuwrap} ref={wrap}>
      <button type="button" className="btn ghost sm" aria-haspopup="menu" aria-expanded={open} aria-label={t("guide.menu.label")} onClick={() => setOpen((o) => !o)}>
        <Icon name="chat" size="s" />{t("guide.menu.help")}
      </button>
      {open && (
        <div className={s.menu} role="menu">
          <button type="button" role="menuitem" onClick={start}>{t("guide.menu.start")}</button>
          <button type="button" role="menuitem" disabled={!hasTour} onClick={() => { setOpen(false); window.dispatchEvent(new CustomEvent(TOUR_EVENT)); }}>
            {hasTour ? t("guide.menu.tour") : t("guide.menu.noTour")}
          </button>
          <Link role="menuitem" href="/app/help">{t("guide.menu.centre")}</Link>
          <Link role="menuitem" href={`/app/support/new?from=${encodeURIComponent(pathname)}`}>{t("support.contactSupport")}{unread > 0 ? ` (${unread})` : ""}</Link>
          <Link role="menuitem" href={`/app/support/new?report=1&from=${encodeURIComponent(pathname)}`}>{t("support.reportProblem")}</Link>
          <Link role="menuitem" href="/app/support">{t("support.title")}{unread > 0 ? ` - ${t("support.menuUnread", { n: unread })}` : ""}</Link>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); window.dispatchEvent(new CustomEvent(WELCOME_EVENT)); }}>{t("guide.menu.welcome")}</button>
        </div>
      )}
    </div>
  );
}
