import type { EventSectionData } from "@/lib/public-api";
import { icsFor, safeHttps } from "./helpers";
import { Countdown } from "./Countdown";
import { Glyph, SectionHead } from "./Head";
import type { SectionContext } from "./types";
import s from "./sections.module.css";

const CAL = "M3 5h18v16H3zM3 10h18M8 3v4M16 3v4";
const SLIDES = "M3 5h18v11H3zM8 21h8M12 16v5";

/** An event block: a countdown to the start, then the stand and the talk when the owner is a speaker, with a calendar file. */
export function Event({ data, ctx, now = new Date() }: { data: EventSectionData; ctx: SectionContext; now?: Date }) {
  const { t } = ctx;
  const ics = icsFor(data, ctx.publicUrl);
  const session = !!data.talk_title;
  const slides = safeHttps(data.slides_url) ? data.slides_url.trim() : null;
  return (
    <section className={`${s.sec} ${s.event}`} data-section="event">
      {data.title && <SectionHead title={data.title} />}
      {data.event_name && <div className={s.live}><i />{data.event_name}</div>}
      <Countdown
        startsAt={data.starts_at}
        endsAt={data.ends_at}
        initialNow={now.getTime()}
        labels={{ startsIn: t("content.startsIn"), days: t("content.days"), hours: t("content.hrs"), minutes: t("content.min"), seconds: t("content.sec"), live: t("content.liveNow"), ended: t("content.ended") }}
      />
      {session && (
        <div className={s.session}>
          <div className={s.top}><small>{t("content.session")}</small><b dir="auto">{data.talk_title}</b></div>
          {(data.talk_time || data.hall || data.stand) && (
            <div className={s.facts3}>
              {data.talk_time && <div><small>{t("content.time")}</small><b className={s.mono}>{data.talk_time}</b></div>}
              {data.hall && <div><small>{t("content.hall")}</small><b dir="auto">{data.hall}</b></div>}
              {data.stand && <div><small>{t("content.stand")}</small><b dir="auto">{data.stand}</b></div>}
            </div>
          )}
        </div>
      )}
      {!session && (data.stand || data.hall || data.venue) && (
        <div className={s.ev}>
          {(data.stand || data.hall) && (
            <div><Glyph name="pin" /><div><b dir="auto">{[data.hall, data.stand].filter(Boolean).join(" · ")}</b><small>{t("content.findStand")}</small></div></div>
          )}
          {data.venue && <div><Glyph name="globe" /><div><b dir="auto">{data.venue}</b><small>{t("content.venue")}</small></div></div>}
        </div>
      )}
      {session && data.venue && <p className={s.hint} dir="auto">{data.venue}</p>}
      {(ics || slides) && (
        <div className={s.actions}>
          {ics && (
            <a className={`${s.btn} ${s.ink}`} href={`data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`} download="event.ics">
              <Glyph d={CAL} />{t("content.addCalendar")}
            </a>
          )}
          {slides && (
            <a className={`${s.btn} ${s.soft}`} href={slides} target="_blank" rel="noopener noreferrer">
              <Glyph d={SLIDES} />{t("content.slides")}
            </a>
          )}
        </div>
      )}
    </section>
  );
}
