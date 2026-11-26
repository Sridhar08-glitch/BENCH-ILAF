// Helpers of the Enterprise requests screen: the price is typed in whole currency units ("25" or "25.50") and sent in minor units.

/** "25" or "25.5" (a comma works too) -> 2500 / 2550; null when it is not a positive amount with at most two decimals. */
export function toMinor(text: string): number | null {
  const clean = text.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const minor = Math.round(parseFloat(clean) * 100);
  return minor > 0 ? minor : null;
}

export function fmtMoney(minor: number | null | undefined, currency: string): string {
  if (minor === null || minor === undefined) return "-";
  return `${(minor / 100).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

export const STATUS_TONE: Record<string, "ok" | "warn" | "bad" | "accent" | ""> = {
  requested: "warn", quoted: "accent", accepted: "ok", declined: "bad", cancelled: "",
};
