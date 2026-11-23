"use client";

// Searchable multi-select with chips, used where a staff screen picks plans, countries or companies instead of typing codes.
import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { sa } from "@/lib/staff-admin/api";
import { countryName } from "@/lib/staff-admin/frame";
import { useDebounced } from "./ui";
import s from "./pickers.module.css";

export interface PickChip { value: string; label: string; sub?: string }

interface ChipPickerProps {
  label: string;
  selected: PickChip[];
  options: PickChip[];
  onChange: (next: PickChip[]) => void;
  onQuery?: (text: string) => void;
  placeholder?: string;
  /** Shown while the options are being searched for. */
  busy?: boolean;
  /** With `minChars` above 0 the list opens only after that many letters (a search over a long list). */
  minChars?: number;
  disabled?: boolean;
  noMatch?: string;
  testId?: string;
}

/** The chips and the box that adds one. The parent decides which `options` match what was typed. */
export function ChipPicker({ label, selected, options, onChange, onQuery, placeholder, busy, minChars = 0, disabled, noMatch = "Nothing matches.", testId }: ChipPickerProps) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const listId = useId();
  const picked = new Set(selected.map((c) => c.value));
  const shown = options.filter((o) => !picked.has(o.value)).slice(0, 50);
  const canOpen = open && text.trim().length >= minChars;

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  function add(chip: PickChip) {
    onChange([...selected, chip]);
    setText("");
    onQuery?.("");
    setActive(0);
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, Math.max(shown.length - 1, 0))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { if (canOpen && shown[active]) { e.preventDefault(); add(shown[active]); } }
    else if (e.key === "Escape") setOpen(false);
    else if (e.key === "Backspace" && text === "" && selected.length > 0) onChange(selected.slice(0, -1));
  }

  return (
    <div className={s.box} ref={wrap} data-testid={testId}>
      <div className={s.field}>
        {selected.map((c) => (
          <span key={c.value} className={s.chip} data-testid="chip">
            <span dir="auto">{c.label}</span>
            <button type="button" aria-label={`Remove ${c.label}`} disabled={disabled} onClick={() => onChange(selected.filter((x) => x.value !== c.value))}>x</button>
          </span>
        ))}
        <input
          value={text} placeholder={selected.length === 0 ? placeholder : ""} aria-label={label} role="combobox" aria-expanded={canOpen} aria-controls={listId} autoComplete="off" disabled={disabled}
          onChange={(e) => { setText(e.target.value); onQuery?.(e.target.value); setOpen(true); setActive(0); }} onFocus={() => setOpen(true)} onKeyDown={onKey}
        />
      </div>
      {canOpen && (
        <div className={s.pop} id={listId} role="listbox" aria-label={label}>
          {busy && shown.length === 0 && <p className={s.none} role="status">Searching...</p>}
          {!busy && shown.length === 0 && <p className={s.none} role="status">{noMatch}</p>}
          {shown.map((o, i) => (
            <button key={o.value} type="button" role="option" aria-selected={i === active} className={s.opt} onClick={() => add(o)}>
              <span dir="auto">{o.label}</span>
              {o.sub && <small dir="auto">{o.sub}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A fixed list (plans, countries): typing narrows it. */
export function ListPicker({ label, all, selected, onChange, placeholder, testId }: { label: string; all: PickChip[]; selected: string[]; onChange: (values: string[]) => void; placeholder?: string; testId?: string }) {
  const [text, setText] = useState("");
  const needle = text.trim().toLowerCase();
  const options = needle ? all.filter((o) => `${o.label} ${o.value}`.toLowerCase().includes(needle)) : all;
  const byValue = new Map(all.map((o) => [o.value, o]));
  const chips = selected.map((v) => byValue.get(v) ?? { value: v, label: v });
  return <ChipPicker label={label} selected={chips} options={options} onQuery={setText} onChange={(next) => onChange(next.map((c) => c.value))} placeholder={placeholder} testId={testId} />;
}

export function countryOptions(rows: { code: string; companies: number }[]): PickChip[] {
  return rows.map((r) => ({ value: r.code, label: countryName(r.code), sub: `${r.companies} ${r.companies === 1 ? "company" : "companies"}` }));
}

/** Companies found by name or owner e-mail; the chips keep the names. */
export function CompanyPicker({ selected, onChange, label = "Companies", placeholder = "Search a company by name or owner e-mail", disabled, testId }: { selected: PickChip[]; onChange: (next: PickChip[]) => void; label?: string; placeholder?: string; disabled?: boolean; testId?: string }) {
  const [text, setText] = useState("");
  const term = useDebounced(text.trim(), 250);
  const q = useQuery({ queryKey: ["staff-company-picker", term], queryFn: () => sa.companies({ q: term, page_size: "8" }), enabled: term.length >= 1, staleTime: 15_000 });
  const options = (q.data?.results ?? []).map((c) => ({ value: c.id, label: c.name, sub: c.owner_email }));
  return <ChipPicker label={label} selected={selected} options={term === text.trim() ? options : []} onQuery={setText} onChange={onChange} placeholder={placeholder} busy={q.isFetching || term !== text.trim()} minChars={1} disabled={disabled} noMatch="No company matches." testId={testId} />;
}
