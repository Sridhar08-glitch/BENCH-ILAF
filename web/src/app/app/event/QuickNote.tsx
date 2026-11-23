"use client";

// The "I met someone" form: saves a note on the phone at once and lets the notes queue send it.
import { useState } from "react";
import { useToast } from "@/components/app/ui";
import { useI18n } from "@/lib/i18n/client";
import type { EventTag } from "@/lib/event/notes";
import type { AddResult } from "@/lib/event/use-notes";
import styles from "./event.module.css";

export interface QuickNoteProps {
  cardId: string | null;
  add: (input: { name: string; company: string; email: string; phone: string; note: string; tag: EventTag; cardId: string | null }) => AddResult;
  eventName: string;
  setEventName: (v: string) => void;
  /** Called after a note is saved (the Meet mode sheet closes itself). */
  onSaved?: () => void;
  /** Show the event name field (the page does; the Meet mode sheet only shows it when it is empty). */
  showEvent?: boolean;
}

const EMPTY = { name: "", company: "", email: "", phone: "", note: "" };

export function QuickNote({ cardId, add, eventName, setEventName, onSaved, showEvent = true }: QuickNoteProps) {
  const { t } = useI18n();
  const toast = useToast();
  const [f, setF] = useState(EMPTY);
  const [tag, setTag] = useState<EventTag>("");
  const [problem, setProblem] = useState("");
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = add({ ...f, tag, cardId });
    if (!r.ok) {
      setProblem(r.problem === "empty" ? t("growth.eventEmpty") : r.problem === "bad_email" ? t("growth.eventBadEmail") : t("growth.eventDuplicate"));
      return;
    }
    setProblem("");
    setF(EMPTY);
    // The tag is kept: at a stand most people get the same one in a row.
    toast(r.queued ? t("growth.eventSavedOffline") : t("growth.eventSaved"));
    onSaved?.();
  }

  const tags: { k: EventTag; label: string; cls: string }[] = [
    { k: "hot", label: t("growth.eventTagHot"), cls: styles.tagHot },
    { k: "warm", label: t("growth.eventTagWarm"), cls: styles.tagWarm },
    { k: "follow_up", label: t("growth.eventTagFollow"), cls: styles.tagFollow },
  ];

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 12 }} noValidate>
      <label>{t("growth.eventName")}<input value={f.name} onChange={set("name")} dir="auto" autoComplete="off" /></label>
      <label>{t("growth.eventCompany")}<input value={f.company} onChange={set("company")} dir="auto" autoComplete="off" /></label>
      <div className="two">
        <label>{t("growth.eventEmail")}<input type="email" inputMode="email" value={f.email} onChange={set("email")} dir="ltr" autoComplete="off" /></label>
        <label>{t("growth.eventPhone")}<input type="tel" inputMode="tel" value={f.phone} onChange={set("phone")} dir="ltr" autoComplete="off" /></label>
      </div>
      <label>{t("growth.eventNote")}<textarea rows={3} value={f.note} onChange={set("note")} dir="auto" /></label>
      <div>
        <div className="hint" style={{ fontWeight: 700, marginBlockEnd: 6 }}>{t("growth.eventTag")}</div>
        <div className={styles.tags} role="group" aria-label={t("growth.eventTag")}>
          {tags.map((x) => (
            <button key={x.k} type="button" className={`${styles.tag} ${x.cls}`} aria-pressed={tag === x.k} onClick={() => setTag(tag === x.k ? "" : x.k)}>{x.label}</button>
          ))}
        </div>
      </div>
      {(showEvent || !eventName) && (
        <label>
          {t("growth.eventEventName")}
          <input value={eventName} onChange={(e) => setEventName(e.target.value)} dir="auto" maxLength={120} autoComplete="off" />
          <span className="hint">{t("growth.eventEventHint")}</span>
        </label>
      )}
      {problem && <span className="err" role="alert">{problem}</span>}
      <button type="submit" className="btn">{t("growth.eventSave")}</button>
    </form>
  );
}
