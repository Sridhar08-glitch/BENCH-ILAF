"use client";

import Link from "next/link";
import { APP_NAME, BRAND_WORDMARK, COMPANY_LOGO, COMPANY_NAME } from "@/lib/config";
import { useOptionalI18n } from "@/lib/i18n/client";

/** Split a product name into the ink part and the orange tail ("BEN" + "CH"). */
export function wordmarkParts(name: string): [string, string] {
  const chars = Array.from(name);
  if (chars.length < 3) return [name, ""];
  const cut = chars.length - 2;
  return [chars.slice(0, cut).join(""), chars.slice(cut).join("")];
}

/** The product wordmark: the name in heavy Poppins, the last two letters in the brand orange. */
export function Wordmark({ name = APP_NAME }: { name?: string }) {
  const [head, tail] = wordmarkParts(name);
  return (
    <span className="wordmark" aria-label={name}>
      {head}
      <span aria-hidden="true">{tail}</span>
    </span>
  );
}

/** The Bench logo picture. A white-label build with another product name keeps the text wordmark instead. */
export function BrandMark({ tone = "light", height = 30 }: { tone?: "light" | "dark"; height?: number }) {
  if (APP_NAME.trim().toLowerCase() !== "bench") return <Wordmark />;
  return (
    <img
      className="brandmark"
      src={tone === "dark" ? BRAND_WORDMARK.white : BRAND_WORDMARK.ink}
      alt={APP_NAME}
      height={height}
      width={Math.round((height * BRAND_WORDMARK.width) / BRAND_WORDMARK.height)}
      style={{ height }}
    />
  );
}

/** The product logo as a link to the home page. */
export function Logo({ href = "/", compact = false }: { href?: string; compact?: boolean }) {
  const i18n = useOptionalI18n();
  return (
    <Link href={href} className={`logo${compact ? " compact" : ""}`} aria-label={i18n ? i18n.t("common.homeOf", { app: APP_NAME }) : `${APP_NAME} home`}>
      <BrandMark height={compact ? 22 : 30} />
    </Link>
  );
}

/**
 * The small "by" line with the company logo. The logo file has dark lettering, so on a dark surface
 * it sits on a small white chip (tone="dark").
 */
export function ByLine({ tone = "light", height = 18 }: { tone?: "light" | "dark"; height?: number }) {
  const i18n = useOptionalI18n();
  const img = (
    <img src={COMPANY_LOGO.src} alt={COMPANY_NAME} height={height} width={Math.round((height * COMPANY_LOGO.width) / COMPANY_LOGO.height)} style={{ height }} />
  );
  return (
    <span className={`byline${tone === "dark" ? " on-dark" : ""}`}>
      <span>{i18n ? i18n.t("common.by") : "by"}</span>
      {tone === "dark" ? <span className="byimg">{img}</span> : img}
    </span>
  );
}

/** The wordmark with "by" and the company logo next to it, for footers. */
export function Lockup({ tone = "light", height = 18 }: { tone?: "light" | "dark"; height?: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <BrandMark tone={tone} height={22} />
      <ByLine tone={tone} height={height} />
    </span>
  );
}
