"use client";

// Mounted once in the app shell. It owns the pieces that float above the pages: the welcome dialog, the small
// "what next" prompt, the page tour and the highlight a checklist step leaves on the page it opens. Pages talk to it
// with window events (see lib/guide/api.ts), so none of them has to import the guide.
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { useWs } from "@/components/app/WorkspaceContext";
import { useI18n } from "@/lib/i18n/client";
import { FLAG, NEXT, needsWelcome, promptDue, stateOf } from "@/lib/guide/engine";
import { GUIDE_EVENT, TOUR_EVENT, WELCOME_EVENT } from "@/lib/guide/api";
import { useGuideProgress, useSaveChanges } from "@/lib/guide/hooks";
import { GUIDES } from "@/lib/guide/guides";
import { placeTip, scrollTarget, spotlight, type Box } from "@/lib/guide/position";
import { promptFor } from "@/lib/guide/whatnext";
import { tourFor } from "@/lib/guide/tours";
import type { NextPrompt, Step, Tour } from "@/lib/guide/types";
import { TourRunner } from "./Tour";
import { Welcome } from "./Welcome";
import s from "./guide.module.css";

/** Only accounts this young see the welcome by themselves; an older account can replay it from the Help menu. */
const WELCOME_WINDOW_DAYS = 14;
/** Pages that set a flag just by being opened. */
const VISIT_FLAGS: Record<string, string> = { "/app/qr": "shared_qr_opened", "/app/background": "background_opened" };
const PROMPT_SECONDS = 20;

const allSteps: Step[] = Object.values(GUIDES).flatMap((g) => g.steps);

export function GuideRoot() {
  const { user, closed } = useWs();
  const pathname = usePathname();
  const progressQ = useGuideProgress();
  const progress = progressQ.data;
  const { save } = useSaveChanges();
  const [welcome, setWelcome] = useState(false);
  const [prompt, setPrompt] = useState<NextPrompt | null>(null);
  const [tour, setTour] = useState<Tour | null>(null);
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const preview = pathname.startsWith("/app/preview/");

  // The welcome opens by itself for a new account that has not seen it.
  const young = Date.now() - new Date(user.created_at).getTime() < WELCOME_WINDOW_DAYS * 86_400_000;
  const due = !!progress && !closed && !preview && young && needsWelcome({ kind: "personal", role: "owner" }, progress);
  useEffect(() => {
    if (due) setWelcome(true);
  }, [due]);

  // Pages announce events; the Help menu asks for the tour or the welcome.
  useEffect(() => {
    const onEvent = (e: Event) => {
      const detail = String((e as CustomEvent).detail ?? "");
      const list = progressRef.current;
      if (!list) return;
      if (detail.startsWith("flag:")) {
        const flag = detail.slice(5);
        if (stateOf(list, FLAG, flag) !== "done") save([{ guide_id: FLAG, step_id: flag, state: "done" }]);
        return;
      }
      const p = promptFor(detail);
      if (p && promptDue(list, detail)) {
        setPrompt(p);
        save([{ guide_id: NEXT, step_id: detail, state: "shown" }]);
      }
    };
    const onTour = () => setTour(tourFor(pathRef.current));
    const onWelcome = () => setWelcome(true);
    window.addEventListener(GUIDE_EVENT, onEvent);
    window.addEventListener(TOUR_EVENT, onTour);
    window.addEventListener(WELCOME_EVENT, onWelcome);
    return () => {
      window.removeEventListener(GUIDE_EVENT, onEvent);
      window.removeEventListener(TOUR_EVENT, onTour);
      window.removeEventListener(WELCOME_EVENT, onWelcome);
    };
  }, [save]);

  // Opening some pages is itself the step ("look at your QR code").
  useEffect(() => {
    const flag = VISIT_FLAGS[pathname];
    if (flag && progress && stateOf(progress, FLAG, flag) !== "done") save([{ guide_id: FLAG, step_id: flag, state: "done" }]);
  }, [pathname, progress, save]);

  // A tour belongs to its page.
  useEffect(() => setTour(null), [pathname]);

  return (
    <>
      {welcome && !preview && <Welcome onClose={() => setWelcome(false)} />}
      {prompt && !welcome && <Prompt prompt={prompt} onClose={() => setPrompt(null)} />}
      {tour && <TourRunner tour={tour} onClose={() => setTour(null)} />}
      {!preview && <Highlight pathname={pathname} />}
    </>
  );
}

/** The small, non-blocking suggestion after a key action. It goes away by itself and never comes back for the same event. */
function Prompt({ prompt, onClose }: { prompt: NextPrompt; onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  useEffect(() => {
    const id = window.setTimeout(onClose, PROMPT_SECONDS * 1000);
    return () => window.clearTimeout(id);
  }, [prompt, onClose]);
  return (
    <div className={s.prompt} role="status" aria-live="polite" aria-label={t("guide.nextPrompt.label")}>
      <div className={s.body}>
        <b>{t(prompt.title)}</b>
        <p>{t(prompt.text)}</p>
        <button type="button" className="btn sm accent" onClick={() => { onClose(); router.push(prompt.route); }}>{t(prompt.action)}</button>
      </div>
      <button type="button" className={s.x} aria-label={t("guide.nextPrompt.dismiss")} onClick={onClose}><Icon name="x2" size="s" /></button>
    </div>
  );
}

/** When a page is opened from a checklist step (?guide=step-id), point at the right spot for a few seconds. */
function Highlight({ pathname }: { pathname: string }) {
  const { t } = useI18n();
  const [shape, setShape] = useState<{ box: Box; label: string; left: number; top: number } | null>(null);
  const done = useCallback(() => setShape(null), []);

  useEffect(() => {
    setShape(null);
    const id = new URLSearchParams(window.location.search).get("guide");
    const step = id ? allSteps.find((x) => x.id === id) : undefined;
    if (!step?.focus) return;
    const focus = step.focus;
    let cancelled = false;
    let tries = 0;
    let opened = false;
    const timers: number[] = [];

    // The page may still be loading: look for the spot a few times.
    const look = () => {
      if (cancelled) return;
      const el = document.querySelector<HTMLElement>(focus.target);
      const r = el?.getBoundingClientRect();
      if (el && r && r.width > 0 && r.height > 0) {
        const vp = { width: document.documentElement.clientWidth, height: window.innerHeight };
        const to = scrollTarget({ top: r.top, left: r.left, width: r.width, height: r.height }, vp, window.scrollY);
        if (to !== null) window.scrollTo({ top: to, behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        timers.push(window.setTimeout(() => {
          if (cancelled) return;
          const r2 = el.getBoundingClientRect();
          const box = spotlight({ top: r2.top, left: r2.left, width: r2.width, height: r2.height }, vp, 4);
          const label = placeTip(box, { width: 260, height: 40 }, vp, document.documentElement.dir === "rtl", 8);
          setShape({ box, label: t(step.title), left: label.left, top: label.top });
          timers.push(window.setTimeout(done, 5000));
        }, to !== null ? 400 : 50));
        return;
      }
      if (focus.openFirst && !opened) {
        const opener = document.querySelector<HTMLElement>(focus.openFirst);
        if (opener) {
          opened = true;
          if (opener.getAttribute("aria-selected") !== "true") opener.click();
        }
      }
      if (++tries < 12) timers.push(window.setTimeout(look, 250));
    };
    timers.push(window.setTimeout(look, 300));
    const stop = () => done();
    window.addEventListener("keydown", stop, { once: true });
    return () => {
      cancelled = true;
      timers.forEach((x) => window.clearTimeout(x));
      window.removeEventListener("keydown", stop);
    };
  }, [pathname, t, done]);

  if (!shape) return null;
  return (
    <>
      <div className={s.glow} style={{ top: shape.box.top, left: shape.box.left, width: shape.box.width, height: shape.box.height }} aria-hidden="true" />
      <div className={s.glowlabel} role="status" style={{ top: shape.top, left: shape.left }}>{shape.label}</div>
    </>
  );
}
