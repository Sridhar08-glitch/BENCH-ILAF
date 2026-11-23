// Decides when and how to offer "install the app". Pure: the page passes in what the browser says.

export type Platform = "ios-safari" | "ios-other" | "android" | "desktop";

/** Which kind of device and browser this is, from the user-agent text. */
export function detectPlatform(ua: string, maxTouchPoints = 0): Platform {
  const text = ua || "";
  // iPadOS 13+ says it is a Mac; the touch screen gives it away.
  const ios = /iPhone|iPad|iPod/i.test(text) || (/Macintosh/i.test(text) && maxTouchPoints > 1);
  if (ios) {
    // Only Safari adds to the home screen from its Share menu on older iOS versions; other iOS browsers get a pointer to Safari.
    const other = /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|GSA\//i.test(text);
    return other ? "ios-other" : "ios-safari";
  }
  if (/Android/i.test(text)) return "android";
  return "desktop";
}

/** True when the app already runs as an installed app (home screen icon, standalone window). */
export function isStandalone(env: { matchMedia?: (q: string) => { matches: boolean }; navigatorStandalone?: boolean }): boolean {
  if (env.navigatorStandalone) return true;
  try {
    return !!env.matchMedia?.("(display-mode: standalone)").matches;
  } catch {
    return false;
  }
}

/** How long a dismissed offer stays hidden. */
export const DISMISS_DAYS = 30;
export const DISMISS_KEY = "bench.install.dismissed";

export interface OfferInput {
  platform: Platform;
  standalone: boolean;
  /** The browser handed us an install prompt (Android and desktop Chrome and Edge). */
  hasPrompt: boolean;
  /** When the person last dismissed the offer (milliseconds since 1970), or null. */
  dismissedAt: number | null;
  now: number;
}

/** "prompt": show the install button; "ios": show the how-to; "none": show nothing. */
export function installOffer(i: OfferInput): "prompt" | "ios" | "none" {
  if (i.standalone) return "none";
  if (i.dismissedAt !== null && i.now - i.dismissedAt < DISMISS_DAYS * 86_400_000) return "none";
  if (i.platform === "ios-safari") return "ios";
  return i.hasPrompt ? "prompt" : "none";
}
