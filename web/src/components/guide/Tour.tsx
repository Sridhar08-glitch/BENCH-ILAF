"use client";

// The page tour: dims the page, boxes one element at a time and explains it in a small bubble.
// Written here (no library). Keyboard: Tab stays in the bubble, Enter and Space press buttons, Esc closes.
// Targets that are missing are skipped, and the bubble centres itself when it cannot point at anything.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { isVisible, nextIndex, placeTip, scrollTarget, spotlight, type Box, type Size, type TipPosition } from "@/lib/guide/position";
import type { Tour } from "@/lib/guide/types";
import { useFocusTrap } from "./useFocusTrap";
import s from "./guide.module.css";

function find(selector: string): HTMLElement | null {
  try {
    return document.querySelector<HTMLElement>(selector);
  } catch {
    return null;
  }
}

function boxOf(el: HTMLElement): Box | null {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? { top: r.top, left: r.left, width: r.width, height: r.height } : null;
}

function viewport(): Size {
  return { width: document.documentElement.clientWidth || window.innerWidth, height: window.innerHeight };
}

const reduced = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Which tips have something to point at right now (an opener counts: it will reveal the target). */
function presence(tour: Tour): boolean[] {
  return tour.tips.map((tip) => {
    const el = find(tip.target);
    if (el && boxOf(el)) return true;
    return !!tip.openFirst && !!find(tip.openFirst);
  });
}

export function TourRunner({ tour, onClose }: { tour: Tour; onClose: () => void }) {
  const { t, dir, number } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [present] = useState(() => presence(tour));
  const first = present.indexOf(true);
  const [index, setIndex] = useState(first);
  const [target, setTarget] = useState<Box | null>(null);
  const [pos, setPos] = useState<TipPosition | null>(null);
  useFocusTrap(ref, onClose, "[data-primary]");

  const measure = useCallback(() => {
    if (index < 0) return;
    const el = find(tour.tips[index].target);
    setTarget(el ? boxOf(el) : null);
  }, [index, tour]);

  // Open what must be open, bring the target into view, then measure it.
  useEffect(() => {
    if (index < 0) return;
    const tip = tour.tips[index];
    let cancelled = false;
    if (tip.openFirst) {
      const opener = find(tip.openFirst);
      if (opener && opener.getAttribute("aria-selected") !== "true") opener.click();
    }
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      const el = find(tip.target);
      const box = el ? boxOf(el) : null;
      if (el && box) {
        const to = scrollTarget(box, viewport(), window.scrollY);
        if (to !== null) window.scrollTo({ top: to, behavior: reduced() ? "auto" : "smooth" });
      }
      measure();
      // A smooth scroll finishes a little later; measure once more.
      window.setTimeout(() => !cancelled && measure(), reduced() ? 0 : 350);
    }, 80);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [index, tour, measure]);

  // Follow the page while it scrolls or resizes.
  useEffect(() => {
    let frame = 0;
    const again = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    window.addEventListener("resize", again);
    window.addEventListener("scroll", again, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", again);
      window.removeEventListener("scroll", again, true);
    };
  }, [measure]);

  // Place the bubble once its own size is known.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const size = { width: el.offsetWidth, height: el.offsetHeight };
    const vp = viewport();
    setPos(placeTip(target && isVisible(target, vp) ? target : null, size, vp, dir === "rtl"));
  }, [target, index, dir]);

  const go = (way: 1 | -1) => {
    const live = presence(tour);
    const to = nextIndex(index, way, live);
    if (to === null) {
      if (way === 1) onClose();
      return;
    }
    setIndex(to);
  };

  const tip = index >= 0 ? tour.tips[index] : null;
  const live = presence(tour);
  const hasPrev = index >= 0 && nextIndex(index, -1, live) !== null;
  const hasNext = index >= 0 && nextIndex(index, 1, live) !== null;
  const count = present.filter(Boolean).length;
  const n = index < 0 ? 0 : present.slice(0, index + 1).filter(Boolean).length;
  const spot = target ? spotlight(target, viewport()) : null;

  return (
    <div className={s.tourveil}>
      {spot ? <div className={s.spot} style={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height }} aria-hidden="true" /> : <div className={`${s.spot} ${s.none}`} aria-hidden="true" />}
      <div
        ref={ref}
        className={s.bubble}
        role="dialog"
        aria-modal="true"
        aria-label={t("guide.tour.dialogLabel", { title: t(tour.title) })}
        style={pos ? { top: pos.top, left: pos.left } : { top: 12, left: 12, visibility: "hidden" }}
      >
        {tip ? (
          <>
            <div className={s.meta}><span>{t("guide.tour.stepOf", { n: number(n), total: number(count) })}</span></div>
            <h3>{t(tip.title)}</h3>
            <p>{t(tip.text)}</p>
          </>
        ) : (
          <p>{t("guide.tour.nothing")}</p>
        )}
        <div className={s.acts}>
          <button type="button" className="btn ghost sm" onClick={onClose}>{t("guide.tour.close")}</button>
          {hasPrev && <button type="button" className="btn ghost sm" onClick={() => go(-1)}>{t("guide.tour.back")}</button>}
          {tip && <button type="button" className="btn sm" data-primary="" onClick={() => go(1)}>{hasNext ? t("guide.tour.next") : t("guide.tour.done")}</button>}
        </div>
      </div>
    </div>
  );
}
