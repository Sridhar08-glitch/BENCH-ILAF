// The drawn icon set used across the app and on cards (stroke icons on a 24 px grid).
import type { CSSProperties } from "react";

const PATHS: Record<string, string> = {
  home: "M3 11.5 12 4l9 7.5M5.5 10v9.5h13V10",
  card: "M3 8.5a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3zM7 10h5M7 14h8",
  qr: "M4.5 3h4a1.5 1.5 0 0 1 1.5 1.5v4A1.5 1.5 0 0 1 8.5 10h-4A1.5 1.5 0 0 1 3 8.5v-4A1.5 1.5 0 0 1 4.5 3zM15.5 3h4A1.5 1.5 0 0 1 21 4.5v4a1.5 1.5 0 0 1-1.5 1.5h-4A1.5 1.5 0 0 1 14 8.5v-4A1.5 1.5 0 0 1 15.5 3zM4.5 14h4a1.5 1.5 0 0 1 1.5 1.5v4A1.5 1.5 0 0 1 8.5 21h-4A1.5 1.5 0 0 1 3 19.5v-4A1.5 1.5 0 0 1 4.5 14zM14 14h3v3h-3zM20 14v3M17 20h4v1",
  users: "M9 4.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM2.5 20c.7-3.5 3.3-5.2 6.5-5.2s5.8 1.7 6.5 5.2M16 5a3.2 3.2 0 0 1 0 6M18.5 14.8c1.7.6 2.7 2.2 3 4.7",
  chart: "M4 20v-9M10 20V4M16 20v-6M21 20H3",
  crown: "M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z",
  gem: "M6 4h12l3 5-9 11L3 9zM3 9h18M9 4l3 5 3-5M12 9v11",
  phone: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z",
  tel: "M6.5 9h11A2.5 2.5 0 0 1 20 11.5v5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5v-5A2.5 2.5 0 0 1 6.5 9zM7 9V6.5C7 5.7 7.7 5 8.5 5h7c.8 0 1.5.7 1.5 1.5V9M12 12a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
  chat: "M21 12a9 9 0 0 1-13.4 7.8L3 21l1.3-4.4A9 9 0 1 1 21 12zM9.2 9c0 3 2.8 5.8 5.8 5.8l1-1.5-2-1-.9.8c-.8-.4-1.6-1.2-2-2l.8-.9-1-2z",
  mail: "M6 5h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3zM3.5 7l8.5 6 8.5-6",
  globe: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z",
  instagram: "M8.5 3.5h7a5 5 0 0 1 5 5v7a5 5 0 0 1-5 5h-7a5 5 0 0 1-5-5v-7a5 5 0 0 1 5-5zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM17 6.4v.2",
  facebook: "M14 8h3V4h-3a4 4 0 0 0-4 4v3H7v4h3v6h4v-6h3l1-4h-4V8.5c0-.3.2-.5.5-.5z",
  linkedin: "M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3zM8 10v7M8 7v.01M12 17v-7M12 13a3 3 0 0 1 6 0v4",
  x: "M5 4l14 16M19 4 5 20",
  youtube: "M6.5 5.5h11a4 4 0 0 1 4 4v5a4 4 0 0 1-4 4h-11a4 4 0 0 1-4-4v-5a4 4 0 0 1 4-4zM10 9.5v5l4.5-2.5z",
  tiktok: "M14 4v10.5a3.5 3.5 0 1 1-3.5-3.5M14 4c.3 2.2 1.8 3.7 4 4",
  pin: "M12 21s7-6 7-11.5a7 7 0 0 0-14 0C5 15 12 21 12 21zM12 7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z",
  share: "M6 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM18 3.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM18 15.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  tap: "M9 11V5a1.7 1.7 0 0 1 3.4 0v5l5 1.2a2 2 0 0 1 1.5 2l-.6 5A3 3 0 0 1 15.3 21H12a3 3 0 0 1-2.4-1.2L6 15l1.5-1.3L9 15z",
  download: "M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14",
  copy: "M10.5 8h7A2.5 2.5 0 0 1 20 10.5v7a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 8 17.5v-7A2.5 2.5 0 0 1 10.5 8zM16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8",
  plus: "M12 5v14M5 12h14",
  search: "M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM16 16l4.5 4.5",
  bell: "M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0",
  nfc: "M6 8a6 6 0 0 1 0 8M10 6a10 10 0 0 1 0 12M14 4a14 14 0 0 1 0 16M18 2.5a17 17 0 0 1 0 19",
  check: "m5 12.5 4.5 4.5L19 7.5",
  user: "M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 20c1-4 4-6 8-6s7 2 8 6",
  adduser: "M10 4.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM3 20c.8-3.4 3.2-5 7-5M18 8v6M15 11h6",
  camera: "M4 8h3l1.5-2.5h7L17 8h3v11H4zM12 9.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z",
  palette: "M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.7 0-1.2-1-1.6-1-2.6 0-.9.7-1.5 1.7-1.5H17a4 4 0 0 0 4-4C21 6.5 17 3 12 3zM7.5 10.2v.1M10 6.7v.1M14.5 6.7v.1",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  scan: "M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16",
  chev: "m9 6 6 6-6 6",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2",
  // extras for the app chrome
  settings: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  brand: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM17 13v7M13 16.5h7",
  logout: "M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3M16 8l4 4-4 4M20 12H9",
  menu: "M4 7h16M4 12h16M4 17h16",
  trash: "M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6",
  upload: "M12 15V4M7.5 8.5 12 4l4.5 4.5M5 20h14",
  lock: "M7 11V8a5 5 0 0 1 10 0v3M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z",
  shield: "M12 3 5 6v5.5c0 4.4 3 8 7 9.5 4-1.5 7-5.1 7-9.5V6zM9 12l2.2 2.2L15.5 10",
  alert: "M12 3 2 20h20zM12 10v4M12 17.5v.1",
  x2: "M6 6l12 12M18 6 6 18",
  arrow: "M7 17 17 7M8 7h9v9",
  down: "M12 5v14M6 13l6 6 6-6",
  // drawn for the extra link types (no brand artwork): a document, a menu with fork and knife, a star
  doc: "M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9.5A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5zM14 3.5V8h4M8.5 12h7M8.5 15.5h7",
  utensils: "M7 3v6a2 2 0 0 0 4 0V3M9 3v18M17 21V3c-2.2 1.2-3.5 3.7-3.5 6.5 0 2 1.2 3 3.5 3.5",
  star: "m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 17l-5.3 2.7 1.1-5.9L3.5 9.7l5.9-.8z",
};

export type IconName = keyof typeof PATHS | (string & {});

interface Props {
  name: IconName;
  /** "s" = 16 px, "l" = 24 px, default 20 px. */
  size?: "s" | "l";
  className?: string;
  style?: CSSProperties;
}

/** The drawing of an icon (SVG path data); unknown names give the link icon. */
export function iconPath(name: string): string {
  return PATHS[name] ?? PATHS.link;
}

export function hasIcon(name: string): boolean {
  return name in PATHS;
}

/** Icons that point somewhere: they are mirrored when the page is right to left (see `.ico-dir` in globals.css). */
const DIRECTIONAL = new Set(["chev", "arrow", "logout"]);

export function Icon({ name, size, className, style }: Props) {
  const px = size === "s" ? 16 : size === "l" ? 24 : 20;
  return (
    <svg
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={DIRECTIONAL.has(name) ? `ico-dir${className ? ` ${className}` : ""}` : className}
      style={{ flex: "none", ...style }}
    >
      <path d={PATHS[name] ?? PATHS.link} />
    </svg>
  );
}
