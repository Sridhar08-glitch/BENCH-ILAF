"use client";

// The bell in the top bar: how many new contacts the person has not looked at yet, and the latest few.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/Icon";
import { useWs } from "./WorkspaceContext";
import { useI18n } from "@/lib/i18n/client";
import { BELL_POLL_MS, bellApi, bellBadge, bellInterval, bellItemKey, bellKey, onContactsPage, type BellData, type BellItem } from "@/lib/leadBell";
import s from "./LeadBell.module.css";

export function LeadBell() {
  const { t, number, relative } = useI18n();
  const { current, closed, suspended, closingDue } = useWs();
  const pathname = usePathname();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  // The list as it was when the person opened it: the server forgets it as soon as it is marked seen.
  const [shown, setShown] = useState<BellItem[]>([]);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  // A closed or suspended company has no contacts to show, so nothing is asked.
  const active = !closed && !suspended && !closingDue;

  const query = useQuery({
    queryKey: bellKey(current.id),
    queryFn: () => bellApi.get(current.id),
    enabled: active,
    retry: false,
    staleTime: BELL_POLL_MS / 2,
    refetchOnWindowFocus: true,
    refetchInterval: () => bellInterval(active, typeof document !== "undefined" && document.hidden),
  });
  const data = query.isError ? undefined : query.data;
  const unread = data?.unread ?? 0;
  const badge = bellBadge(unread);

  const seen = useMutation({
    mutationFn: () => bellApi.seen(current.id),
    onSuccess: () => qc.setQueryData<BellData>(bellKey(current.id), { unread: 0, latest: [] }),
  });
  const markSeen = seen.mutate;

  useEffect(() => {
    setOpen(false);
  }, [pathname, current.id]);

  // Being on the Contacts page is looking at the contacts.
  const onContacts = onContactsPage(pathname);
  useEffect(() => {
    if (active && onContacts && unread > 0) markSeen();
  }, [active, onContacts, unread, markSeen]);

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

  if (!active) return null;

  function toggle() {
    if (!open) {
      setShown(data?.latest ?? []);
      if (unread > 0) markSeen();
    }
    setOpen((o) => !o);
  }

  const label = badge ? t("shell.bell.labelCount", { n: unread }) : t("shell.bell.label");
  return (
    <div className={s.wrap} ref={wrap}>
      <button ref={button} type="button" className={`btn ghost sm ${s.btn}`} aria-haspopup="dialog" aria-expanded={open} aria-label={label} onClick={toggle}>
        <Icon name="bell" size="s" />
        {badge && <span className={s.badge} aria-hidden="true">{number(badge.value)}{badge.over ? "+" : ""}</span>}
      </button>
      <span className="sr-only" role="status">{badge ? label : ""}</span>
      {open && (
        <div className={s.pop} role="dialog" aria-label={t("shell.bell.title")}>
          <b className={s.head}>{t("shell.bell.title")}</b>
          {shown.length === 0 ? (
            <p className={s.empty}>{t("shell.bell.empty")}</p>
          ) : (
            <ul className={s.list}>
              {shown.map((l) => (
                <li key={l.id}>
                  <Link href={`/app/contacts?lead=${l.id}`} className={s.item} onClick={() => setOpen(false)}>
                    <span className={s.dot} aria-hidden="true"><Icon name={l.kind === "meeting_request" ? "clock" : "adduser"} size="s" /></span>
                    <span className={s.text}>
                      <span className={s.name}>{t(bellItemKey(l.kind), { name: l.name })}</span>
                      <span className={s.meta}>{[l.card_name, relative(l.created_at)].filter(Boolean).join(" · ")}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link href="/app/contacts" className={s.all} onClick={() => setOpen(false)}>{t("shell.bell.seeAll")}</Link>
        </div>
      )}
    </div>
  );
}
