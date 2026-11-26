"use client";

import { useEffect, useState } from "react";
import { countdownParts, pad2, type CountdownParts } from "./helpers";
import s from "./sections.module.css";

interface Labels {
  startsIn: string;
  days: string;
  hours: string;
  minutes: string;
  seconds: string;
  live: string;
  ended: string;
}

/** The tiles that count down to the event start. The server draws the first state; the browser then ticks every second. */
export function Countdown({ startsAt, endsAt, labels, initialNow }: { startsAt: string; endsAt: string | null; labels: Labels; initialNow: number }) {
  const [parts, setParts] = useState<CountdownParts>(() => countdownParts(startsAt, endsAt, new Date(initialNow)));
  useEffect(() => {
    const tick = () => setParts(countdownParts(startsAt, endsAt, new Date()));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [startsAt, endsAt]);

  if (parts.state === "live") return <div className={s.live} data-state="live"><i />{labels.live}</div>;
  if (parts.state === "ended") return <div className={`${s.live} ${s.off}`} data-state="ended"><i />{labels.ended}</div>;
  const showDays = parts.days > 0;
  return (
    <div data-state="before" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <div className={s.cdl}>{labels.startsIn}</div>
      <div className={s.cd} role="timer" aria-live="off">
        {showDays && <div><b>{pad2(parts.days)}</b><small>{labels.days}</small></div>}
        {showDays && <span>:</span>}
        <div><b>{pad2(parts.hours)}</b><small>{labels.hours}</small></div>
        <span>:</span>
        <div><b>{pad2(parts.minutes)}</b><small>{labels.minutes}</small></div>
        {!showDays && <span>:</span>}
        {!showDays && <div><b>{pad2(parts.seconds)}</b><small>{labels.seconds}</small></div>}
      </div>
    </div>
  );
}
