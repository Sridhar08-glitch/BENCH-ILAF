import type { ReactNode } from "react";
import { iconPath } from "@/components/Icon";
import s from "./sections.module.css";

/** The small uppercase heading of a section, with an optional pill on the end (an item count, a swipe hint). */
export function SectionHead({ title, right, big }: { title: string; right?: ReactNode; big?: boolean }) {
  return (
    <div className={s.head}>
      <h2 className={`${s.title}${big ? ` ${s.big}` : ""}`} dir="auto">{title}</h2>
      {right}
    </div>
  );
}

/** A stroke icon from the app's drawn set (or a path of its own), sized by the class it is given. */
export function Glyph({ name, d, className, strokeWidth = 2 }: { name?: string; d?: string; className?: string; strokeWidth?: number }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={d ?? iconPath(name ?? "link")} />
    </svg>
  );
}
