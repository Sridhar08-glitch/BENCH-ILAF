"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keeps keyboard focus inside `ref` while it is mounted: focus moves in when it opens, Tab and Shift+Tab wrap around,
 * Escape calls `onEscape`, and focus returns to what had it before when it closes.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, onEscape?: () => void, initial?: string) {
  const escape = useRef(onEscape);
  escape.current = onEscape;
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const before = document.activeElement as HTMLElement | null;
    const items = () => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
    const start = (initial ? root.querySelector<HTMLElement>(initial) : null) ?? items()[0] ?? root;
    if (start === root && !root.hasAttribute("tabindex")) root.setAttribute("tabindex", "-1");
    start.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        escape.current?.();
        return;
      }
      if (e.key !== "Tab") return;
      const list = items();
      if (list.length === 0) {
        e.preventDefault();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !root.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !root.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (before && document.contains(before)) before.focus();
    };
    // The trap is set up once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
