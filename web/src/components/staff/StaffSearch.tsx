"use client";

// The search box in the staff top bar: type two letters to find companies, people and cards across the product.
// A company opens its staff page; a person or a card opens in place; "See all results" goes to People and cards.
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "@/components/Icon";
import { useI18n } from "@/lib/i18n/client";
import { sa } from "@/lib/staff-admin/api";
import { companyHref, isSearchShortcut, moveActive, searchAllHref, searchRows, SEARCH_MIN_CHARS, type SearchRow } from "@/lib/staff-admin/frame";
import { useDebounced } from "@/components/staff-admin/ui";
import s from "./StaffSearch.module.css";

const CardDrawer = dynamic(() => import("@/components/staff-admin/People").then((m) => m.CardDrawer), { ssr: false });
const UserDrawer = dynamic(() => import("@/components/staff-admin/People").then((m) => m.UserDrawer), { ssr: false });

const GROUP_KEY = { company: "staff.search.companies", person: "staff.search.people", card: "staff.search.cards" } as const;
const ICON = { company: "users", person: "user", card: "card" } as const;

export function StaffSearch() {
  const { t } = useI18n();
  const router = useRouter();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState(false);
  const [active, setActive] = useState(-1);
  const [drawer, setDrawer] = useState<{ kind: "card" | "person"; id: string } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const term = useDebounced(text.trim(), 250);
  const enabled = term.length >= SEARCH_MIN_CHARS;
  const q = useQuery({ queryKey: ["staff-topbar-search", term], queryFn: () => sa.search(term), enabled, staleTime: 15_000, placeholderData: (p) => p });
  const rows = useMemo(() => (enabled ? searchRows(q.data) : []), [enabled, q.data]);
  const showPop = open && text.trim().length >= SEARCH_MIN_CHARS;

  // "/" puts the cursor in the box, like the search of the sites people already use.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (!isSearchShortcut(e)) return;
      e.preventDefault();
      setPhone(true);
      setOpen(true);
      window.setTimeout(() => input.current?.focus(), 0);
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) close(); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  function close() {
    setOpen(false);
    setPhone(false);
    setActive(-1);
  }

  function pick(row: SearchRow) {
    close();
    setText("");
    if (row.kind === "company") router.push(companyHref(row.id));
    else setDrawer({ kind: row.kind, id: row.id });
  }

  function seeAll() {
    const target = searchAllHref(text);
    close();
    router.push(target);
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      close();
      input.current?.blur();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => moveActive(i, rows.length, e.key as "ArrowDown" | "ArrowUp"));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (active >= 0 && rows[active]) pick(rows[active]);
      else if (text.trim().length >= SEARCH_MIN_CHARS) seeAll();
    }
  }

  let lastKind = "";
  return (
    <div className={s.wrap} ref={wrap} data-open={phone || undefined} data-testid="staff-search">
      <button type="button" className={`btn ghost sm ${s.openBtn}`} aria-label={t("staff.search.open")} onClick={() => { setPhone(true); setOpen(true); window.setTimeout(() => input.current?.focus(), 0); }}>
        <Icon name="search" size="s" />
      </button>
      <label className={s.field}>
        <span className="sr-only">{t("staff.search.label")}</span>
        <span className={s.icon} aria-hidden="true"><Icon name="search" size="s" /></span>
        <input
          ref={input} type="search" value={text} placeholder={t("staff.search.placeholder")} autoComplete="off" role="combobox" aria-expanded={showPop} aria-controls={listId}
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined} onChange={(e) => { setText(e.target.value); setOpen(true); setActive(-1); }}
          onFocus={() => setOpen(true)} onKeyDown={onKey} data-testid="staff-search-input"
        />
      </label>
      {showPop && (
        <div className={s.pop} id={listId} role="listbox" aria-label={t("staff.search.label")} data-testid="staff-search-pop">
          {q.isFetching && rows.length === 0 && <p className={s.empty} role="status">{t("staff.search.loading")}</p>}
          {!q.isFetching && enabled && rows.length === 0 && !q.error && <p className={s.empty} role="status">{t("staff.search.none")}</p>}
          {q.error && <p className={s.empty} role="alert">{t("staff.search.failed")}</p>}
          {rows.map((r, i) => {
            const head = r.kind !== lastKind;
            lastKind = r.kind;
            return (
              <div key={`${r.kind}-${r.id}`} role="presentation">
                {head && <div className={s.group} role="presentation">{t(GROUP_KEY[r.kind])}</div>}
                <button type="button" role="option" id={`${listId}-${i}`} aria-selected={i === active} className={s.item} onClick={() => pick(r)} data-testid={`staff-search-${r.kind}`}>
                  <span className={s.dot} aria-hidden="true"><Icon name={ICON[r.kind]} size="s" /></span>
                  <span className={s.text}><span className={s.title} dir="auto">{r.title}</span>{r.sub && <span className={s.sub} dir="auto">{r.sub}</span>}</span>
                </button>
              </div>
            );
          })}
          {enabled && (
            <Link href={searchAllHref(text)} className={`${s.item} ${s.all}`} onClick={() => { close(); }} data-testid="staff-search-all">{t("staff.search.all")}</Link>
          )}
        </div>
      )}
      {drawer?.kind === "card" && <CardDrawer id={drawer.id} onClose={() => setDrawer(null)} />}
      {drawer?.kind === "person" && <UserDrawer id={drawer.id} onClose={() => setDrawer(null)} />}
    </div>
  );
}
