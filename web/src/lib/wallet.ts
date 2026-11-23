// Small helpers for the wallet button.

/** True on an iPhone, iPad or iPod, where Apple Wallet would be the natural choice. */
export function isAppleDevice(ua: string = typeof navigator === "undefined" ? "" : navigator.userAgent): boolean {
  return /iPhone|iPad|iPod/i.test(ua);
}

/** The "save to wallet" link must point at Google's own address. */
export function isGoogleSaveUrl(url: string): boolean {
  return url.startsWith("https://pay.google.com/gp/v/save/");
}
