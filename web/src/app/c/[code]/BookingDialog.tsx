"use client";

// The booking calendar a visitor opens from the card's "Book a time" button: pick a free day and time, leave contact
// details, get a confirmation. Free times come from the API (hours, buffers and other bookings are already applied);
// the same time cannot be taken twice because the server checks it again when the request arrives.
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import c from "./Commerce.module.css";
import { ConsentLine, Finished, Honeypot, Sheet, emailOk } from "./CommerceShell";
import { ApiError } from "@/lib/api";
import { publicCommerce, type BookingInfo, type BookingPlaced } from "@/lib/api-commerce";
import { AVAILABILITY_DAYS, addDays, dayLabel, openDays, slotLabel, todayIn, type AvailabilityDay } from "@/lib/commerce/booking";
import { apiErrorText } from "@/lib/i18n/api-error";
import { useI18n } from "@/lib/i18n/client";
import type { EventSource } from "@/lib/types";

interface Props {
  code: string;
  source: EventSource | null;
  hostName: string;
  onClose: () => void;
  /** The owner's preview: the calendar works, but nothing is booked. */
  preview?: boolean;
}

type Loaded = Extract<BookingInfo, { enabled: true }>;

export function BookingDialog({ code, source, hostName, onClose, preview }: Props) {
  const { t, locale, number } = useI18n();
  const [info, setInfo] = useState<Loaded | null>(null);
  const [off, setOff] = useState(false);
  const [days, setDays] = useState<AvailabilityDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [asked, setAsked] = useState(0);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [form, setForm] = useState({ name: "", email: "", phone: "", note: "", website_url: "" });
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [placed, setPlaced] = useState<BookingPlaced | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const [previewDone, setPreviewDone] = useState(false);
  const opened = useRef(Date.now());
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  /** Ask for the next stretch of days after those already shown (or from today when none are). */
  const load = useCallback(
    async (zone: string, horizon: number, shown: AvailabilityDay[]) => {
      setLoading(true);
      setLoadError("");
      try {
        const start = shown.length ? addDays(shown[shown.length - 1].date, 1) : todayIn(zone);
        const left = horizon - shown.length;
        const answer = await publicCommerce.availability(code, start, Math.max(1, Math.min(AVAILABILITY_DAYS, left)));
        setDays(shown.concat(answer.days));
        setAsked((n) => n + 1);
      } catch (e) {
        setLoadError(apiErrorText(e, t, "commerce.bookLoadFailed"));
      } finally {
        setLoading(false);
      }
    },
    [code, t],
  );

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const i = await publicCommerce.bookingInfo(code);
        if (!live) return;
        if (!i.enabled) {
          setOff(true);
          setLoading(false);
          return;
        }
        setInfo(i);
        await load(i.timezone, i.days_ahead, []);
      } catch (e) {
        if (!live) return;
        if (e instanceof ApiError && e.code === "feature_off") setOff(true);
        else setLoadError(apiErrorText(e, t, "commerce.bookLoadFailed"));
        setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
    // The calendar is asked for once, when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const free = openDays(days);
  const slots = days.find((d) => d.date === date)?.slots ?? [];
  const more = info !== null && days.length < info.days_ahead && !loading;

  function pickDay(d: string) {
    setDate(d);
    setTime("");
    setError("");
  }

  function problem(): string | null {
    if (!date || !time) return t("commerce.errPick");
    if (!form.name.trim()) return t("card.errName");
    if (!form.email.trim()) return t("commerce.errEmailNeeded");
    if (!emailOk(form.email)) return t("card.errEmail");
    if (!consent) return t("card.errConsent");
    return null;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const stop = problem();
    if (stop) return setError(stop);
    if (preview) return setPreviewDone(true);
    setBusy(true);
    setError("");
    try {
      const done = await publicCommerce.book(code, {
        date,
        time,
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
        note: form.note.trim() || undefined,
        consent: true,
        opened_at: opened.current,
        source,
        website_url: form.website_url,
      });
      setPlaced(done);
    } catch (err) {
      setError(apiErrorText(err, t, "commerce.bookFailed"));
      setBusy(false);
      // Someone else may have taken the time: show the free times again.
      if (info && err instanceof ApiError && err.status === 400) {
        setTime("");
        void load(info.timezone, info.days_ahead, []);
      }
    }
  }

  async function cancel() {
    if (!placed) return;
    try {
      await publicCommerce.cancelBooking(placed.id, form.email.trim());
      setCancelled(true);
    } catch (err) {
      setError(apiErrorText(err, t, "commerce.cancelFailed"));
    }
  }

  if (previewDone) {
    return (
      <Finished title={t("commerce.previewTitle")} onClose={onClose}>
        <p>{t("commerce.previewBookText")}</p>
      </Finished>
    );
  }

  if (placed) {
    return (
      <Finished title={cancelled ? t("commerce.cancelledTitle") : t("commerce.bookedTitle")} onClose={onClose}>
        {cancelled ? (
          <p>{t("commerce.cancelledText")}</p>
        ) : (
          <>
            <p>{t("commerce.bookedText", { name: hostName, when: `${dayLabel(date, locale, "long")}, ${slotLabel(time, locale)}`, email: form.email.trim() })}</p>
            {info?.meet_link && <a href={info.meet_link} target="_blank" rel="noopener noreferrer">{t("commerce.meetLink")}</a>}
            <button type="button" className={c.mini} onClick={() => void cancel()}>{t("commerce.cancelRequest")}</button>
            {error && <p className={c.error} role="alert">{error}</p>}
          </>
        )}
      </Finished>
    );
  }

  return (
    <Sheet id="booking-title" title={t("commerce.bookTitle", { name: hostName })} onClose={onClose} onSubmit={submit}>
      {off ? (
        <p>{t("commerce.bookOff")}</p>
      ) : (
        <>
          {info && (info.location_note || info.timezone) && (
            <p className={c.hintRow}>
              {info.location_note && <>{t("commerce.bookWhere", { note: info.location_note })} · </>}
              {t("commerce.bookZone", { zone: info.timezone })}
            </p>
          )}
          {loadError && <p className={c.error} role="alert">{loadError}</p>}
          {loading && days.length === 0 && <p className={c.hintRow} role="status">{t("commerce.bookLoading")}</p>}
          {!loading && !loadError && free.length === 0 && asked > 0 && <p>{t("commerce.bookNone")}</p>}

          {free.length > 0 && (
            <>
              <b>{t("commerce.bookDay")}</b>
              <div className={c.days} role="group" aria-label={t("commerce.bookDay")}>
                {free.map((d) => (
                  <button key={d.date} type="button" className={c.day} aria-pressed={date === d.date} onClick={() => pickDay(d.date)}>
                    <span>{dayLabel(d.date, locale)}</span>
                    <b>{number(d.slots.length)}</b>
                  </button>
                ))}
              </div>
            </>
          )}
          {more && <button type="button" className={c.mini} onClick={() => info && void load(info.timezone, info.days_ahead, days)}>{t("commerce.bookMore")}</button>}

          {date && slots.length > 0 && (
            <>
              <b>{t("commerce.bookTime")}</b>
              <div className={c.slots} role="group" aria-label={t("commerce.bookTime")}>
                {slots.map((s) => (
                  <button key={s} type="button" className={c.slot} aria-pressed={time === s} onClick={() => setTime(s)}>{slotLabel(s, locale)}</button>
                ))}
              </div>
            </>
          )}

          {date && time && (
            <>
              <label>
                <span>{t("card.formName")}<span aria-hidden="true"> *</span></span>
                <input value={form.name} onChange={set("name")} autoComplete="name" required />
              </label>
              <div className="two">
                <label>
                  <span>{t("commerce.emailRequired")}<span aria-hidden="true"> *</span></span>
                  <input className="ltr" type="email" value={form.email} onChange={set("email")} autoComplete="email" required />
                </label>
                <label>
                  <span>{t("commerce.phoneOptional")}</span>
                  <input className="ltr" type="tel" inputMode="tel" value={form.phone} onChange={set("phone")} autoComplete="tel" />
                </label>
              </div>
              <label>
                <span>{t("commerce.bookNote")}</span>
                <textarea dir="auto" rows={2} maxLength={500} value={form.note} onChange={set("note")} />
              </label>
              <Honeypot value={form.website_url} onChange={(v) => setForm((f) => ({ ...f, website_url: v }))} />
              <ConsentLine id="booking-consent" text={t("commerce.bookConsent", { name: hostName })} checked={consent} onChange={setConsent} />
            </>
          )}
          {error && <p className={c.error} role="alert">{error}</p>}
          {date && time && <button type="submit" className="btn" disabled={busy}>{busy ? t("commerce.sending") : t("commerce.bookSend", { when: `${dayLabel(date, locale)}, ${slotLabel(time, locale)}` })}</button>}
        </>
      )}
      <button type="button" className="btn ghost" onClick={onClose}>{t("card.close")}</button>
    </Sheet>
  );
}
