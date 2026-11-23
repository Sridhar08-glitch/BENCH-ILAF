// Number and date formatting shared by screens.

/** Price from minor units (cents, fils) with the currency, for example "QAR 49". */
export function money(minor: number, currency: string): string {
  const major = minor / 100;
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency,
      minimumFractionDigits: major % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(major);
  } catch {
    return `${major} ${currency}`;
  }
}
