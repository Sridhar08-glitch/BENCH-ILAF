"use client";

// A country picker: type to narrow the list, then choose from it. It is a text box and a plain list, so the keyboard and screen
// readers work as they do everywhere else. Names come from the browser in the language of the screen; the value is the ISO code.
import { useId, useMemo, useState } from "react";
import { countryOptions, filterCountries } from "@/lib/countries";
import { useI18n } from "@/lib/i18n/client";

export function CountrySelect({ value, onChange, label }: { value: string; onChange: (code: string) => void; label?: string }) {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState("");
  const id = useId();
  const all = useMemo(() => countryOptions(locale), [locale]);
  const shown = useMemo(() => {
    const matches = filterCountries(all, query);
    // the chosen country stays in the list while something else is typed, so the box never shows a blank choice
    return value && !matches.some((o) => o.code === value) ? [...all.filter((o) => o.code === value), ...matches] : matches;
  }, [all, query, value]);
  return (
    <div>
      <label htmlFor={`${id}-pick`}>{label ?? t("common.country")}</label>
      <input
        type="search" dir="auto" value={query} onChange={(e) => setQuery(e.target.value)}
        placeholder={t("common.countrySearch")} aria-label={t("common.countrySearch")} autoComplete="off"
      />
      <select id={`${id}-pick`} value={value} onChange={(e) => onChange(e.target.value)} aria-describedby={`${id}-count`}>
        <option value="">{t("common.countryNone")}</option>
        {shown.map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}
      </select>
      <span id={`${id}-count`} className="hint" role="status">{query ? t("common.countryMatches", { n: shown.length }) : ""}</span>
    </div>
  );
}
