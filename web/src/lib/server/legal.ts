// The privacy policy and terms: the texts are Markdown files in web/content/legal/<doc>.<language>.md, so a lawyer can
// replace them without touching code. Settings (read from the server environment when the page is drawn):
//   LEGAL_DRAFT_BANNER   "true" (default) shows the "Draft for legal review" banner on both pages; "false" hides it.
//   COMPANY_SUPPORT_EMAIL  the contact address printed in both texts.
import { readFileSync } from "node:fs";
import path from "node:path";
import { APP_NAME, COMPANY_NAME } from "@/lib/config";
import { fillPlaceholders, parseMarkdown, type Block } from "@/lib/legal/markdown";
import type { Locale } from "@/lib/i18n/config";

export type LegalDoc = "privacy" | "terms";

export interface LegalSettings {
  draftBanner: boolean;
  supportEmail: string;
}

export function legalSettings(env: Record<string, string | undefined> = process.env): LegalSettings {
  const flag = (env.LEGAL_DRAFT_BANNER ?? "true").trim().toLowerCase();
  return {
    draftBanner: !["false", "0", "no", "off"].includes(flag),
    supportEmail: (env.COMPANY_SUPPORT_EMAIL ?? "").trim(),
  };
}

const DIR = path.join(process.cwd(), "content", "legal");

/** The document in the language asked for, or in English when there is no file for it. Placeholders are filled in. */
export function loadLegal(doc: LegalDoc, locale: Locale, supportMissing: string, settings: LegalSettings = legalSettings()): Block[] {
  let text: string;
  try {
    text = readFileSync(path.join(DIR, `${doc}.${locale}.md`), "utf8");
  } catch {
    text = readFileSync(path.join(DIR, `${doc}.en.md`), "utf8");
  }
  return parseMarkdown(
    fillPlaceholders(text, {
      COMPANY_NAME,
      APP_NAME,
      SUPPORT_EMAIL: settings.supportEmail || supportMissing,
    }),
  );
}
