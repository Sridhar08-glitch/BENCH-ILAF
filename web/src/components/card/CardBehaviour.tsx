"use client";

// The thin client part of a card page. The card markup is made by the design engine (on the server for the
// public page, in the browser for the editor) and arrives here as children; this component only attaches
// behaviour to it: flip, tabs, link taps, Save contact, the opening animation and long-name fitting.
// It never imports the engine, so the public page does not ship it.
import { useCallback, useEffect, useLayoutEffect, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { enhance, replay, settle } from "@/lib/library/enhance";
import { MEETING_FORM_HREF } from "@/lib/card/meeting";

export type TabGroup = "c" | "s" | "w";

interface Props {
  children: ReactNode;
  /** Kind of each button in markup order (a link's `data-i` is its position here). */
  kinds: string[];
  /** Ready-made markup of each tab, drawn on the server. */
  tabs?: Partial<Record<TabGroup, string>>;
  /** Draws a tab in the browser (editor preview), used when `tabs` has no entry. */
  getTab?: (group: TabGroup) => string;
  onSave?: () => void;
  /** A Meeting button set to the built-in request form was tapped. */
  onMeeting?: () => void;
  onItemClick?: (kind: string) => void;
  /** Play the opening animation after mount. */
  play: boolean;
  /** Change this value to play the opening animation again. */
  playKey?: string | number;
  /** Show the QR back at first and keep the side across redraws. */
  flipped?: boolean;
  /** Changes whenever the markup was replaced, so the polish runs again. */
  contentKey?: string;
  /** Thumbnails are not interactive. */
  inert?: boolean;
}

export function CardBehaviour({ children, kinds, tabs, getTab, onSave, onMeeting, onItemClick, play, playKey = 0, flipped, contentKey = "", inert }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const flipRef = useRef(!!flipped);

  useLayoutEffect(() => {
    flipRef.current = !!flipped;
  }, [flipped]);

  // The markup was replaced (the owner typed something): keep the card on the side it was showing.
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.querySelector(".card")?.classList.toggle("flipped", flipRef.current);
    enhance(root, { measure: !inert });
  }, [contentKey, inert]);

  useEffect(() => {
    const root = ref.current;
    if (root && play) replay(root);
  }, [play, playKey]);

  // Wide fonts load late; fit the names again once they are in.
  useEffect(() => {
    const root = ref.current;
    if (root && document.fonts?.ready) document.fonts.ready.then(() => settle(root, { measure: !inert }));
  }, [contentKey, inert]);

  const flip = useCallback((card: Element) => {
    flipRef.current = !card.classList.contains("flipped");
    card.classList.toggle("flipped", flipRef.current);
  }, []);

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    const tab = t.closest<HTMLElement>("[data-tab]");
    if (tab) {
      const group = tab.dataset.tab as TabGroup;
      const box = tab.closest(".dv")?.querySelector<HTMLElement>(".tabc");
      Array.from(tab.parentElement?.children ?? []).forEach((x) => x.setAttribute("aria-pressed", String(x === tab)));
      const html = tabs?.[group] ?? getTab?.(group);
      if (box && html !== undefined) box.innerHTML = html;
      return;
    }
    const link = t.closest<HTMLAnchorElement>("a[data-i]");
    if (link) {
      if (!link.getAttribute("href")) {
        e.preventDefault();
        return;
      }
      if (link.getAttribute("href") === MEETING_FORM_HREF) {
        e.preventDefault();
        onMeeting?.();
        return;
      }
      const kind = kinds[Number(link.dataset.i)];
      if (kind) onItemClick?.(kind);
      return;
    }
    if (t.closest("[data-save]")) {
      // On the public page this is a link to the contact file for visitors without scripts.
      e.preventDefault();
      onSave?.();
      return;
    }
    const card = t.closest(".card");
    if (card) flip(card);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const card = (e.target as HTMLElement).closest(".card");
    if (card && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      flip(card);
    }
  };

  // `display: contents` keeps this wrapper out of the layout, so the card sits exactly where it would without it.
  return (
    <div ref={ref} style={{ display: "contents" }} onClick={inert ? undefined : onClick} onKeyDown={inert ? undefined : onKeyDown}>
      {children}
    </div>
  );
}
