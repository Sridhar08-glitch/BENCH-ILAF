// Two source scans that keep every sentence the user can see translatable:
//  1. no page shows `error.message` (the server's English sentence) itself: it goes through api-error.ts;
//  2. no JSX text or visible string prop is hard-coded English: it lives in lib/i18n/en and ar.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "../..");

function files(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "generated") continue;
      files(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(full);
  }
  return out;
}

const rel = (f: string) => path.relative(SRC, f).split(path.sep).join("/");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:])\/\/.*$/gm, "$1");

// ---------------------------------------------------------------- 1. raw server text
// Files that build or read the server's sentence on purpose: they never put it on a screen themselves.
const RAW_MESSAGE_ALLOWED = new Set(["lib/api.ts", "lib/i18n/api-error.ts"]);
const RAW_MESSAGE = /\b(?:e|e2|err|error|ex|exc|cause|apiError)\??\.message\b(?!\.\w)/;

describe("no raw server text on screen", () => {
  it("no file reads ApiError.message outside the error helper", () => {
    const hits: string[] = [];
    for (const f of files(SRC)) {
      if (RAW_MESSAGE_ALLOWED.has(rel(f))) continue;
      stripComments(fs.readFileSync(f, "utf8")).split("\n").forEach((line, i) => {
        if (RAW_MESSAGE.test(line)) hits.push(`${rel(f)}:${i + 1}: ${line.trim().slice(0, 110)}`);
      });
    }
    expect(hits, "use apiErrorText(error, t, fallbackKey) from @/lib/i18n/api-error").toEqual([]);
  });
});

// ---------------------------------------------------------------- 2. hard-coded English
// Words that are the same in both languages (names, technical terms) never count as untranslated English.
const KEEP = new Set([
  "qr", "vcard", "csv", "api", "webhook", "webhooks", "url", "pdf", "png", "jpg", "jpeg", "webp", "svg", "json", "html", "css", "ip", "id", "ok",
  "whatsapp", "linkedin", "instagram", "google", "wallet", "apple", "nfc", "sms", "email", "gmail", "outlook", "x", "tiktok", "youtube", "facebook",
  "snapchat", "telegram", "github", "zapier", "hubspot", "salesforce", "zoho", "pipedrive", "crm", "idempotency", "bearer", "authorization", "http", "https",
  "uuid", "utf", "totp", "sso", "ssl", "tls", "dns", "txt", "log", "xlsx", "ics", "vcf",
]);
// Files that legitimately hold English: the catalogues, the brand module, sample data, tests, generated code.
const SCAN_SKIP = [
  /^lib\/i18n\/(en|ar)\//, /^lib\/brand\/(sample|info)/, /^lib\/library\//, /^lib\/guide\/(tours|content)/, /^app\/api\//, /^lib\/og\//, /^lib\/server\//,
  /^components\/staff-admin\//, /^lib\/staff-admin\//, /^app\/staff\/(?!support|requests|faces|companies|audit|security)/,
  /^components\/lucide-set/, /^lib\/card\/(labels|arabic-personas)/, /^lib\/dev\/examples/, /^components\/designs\/shared/, /^app\/(robots|sitemap|manifest)/, /^app\/(opengraph|icon|apple-icon)/,
];
const PROPS = ["placeholder", "aria-label", "title", "alt", "label", "aria-description", "aria-placeholder"];
const PROP_RE = new RegExp(`\\b(${PROPS.join("|")})=("([^"{}]*)"|'([^'{}]*)')`, "g");
// Text between an opening tag and the next tag on one line; and a line that is only prose (a text node of its own).
const TEXT_RE = /<[A-Za-z][\w.]*(?:\s[^<>]*[^/<>\s=])?>([^<>{}\n()[\];=?]*[A-Za-z]{3,}[^<>{}\n()[\];=?]*)</g;
const PROSE_LINE = /^[A-Z][A-Za-z0-9,.'’!?:&/ -]*\s[A-Za-z0-9,.'’!?:&/ -]+$/;
// A sentence passed straight to something that shows it, and a sentence written into page metadata or a visible object field.
const CALL_RE = /\b(toast|setErr|setError|setMsg|setNotice|setGeneral|setProblem|setMessage|alert|confirm|announce)\(\s*(["'`])([^"'`$]*)\2/g;
const META_RE = /\b(title|description|label|hint|placeholder|text|message|heading|subtitle)\s*:\s*"([^"\n]*)"/g;
// A list of capitalised names, as in a multi-line import.
const NAME_LIST = /^([A-Z]\w*,\s*)+[A-Z]?\w*,?$/;
const CODE_WORD = /^(import|export|return|const|let|var|if|else|case|default|type|interface|throw|await)\b/;

/** English prose: at least one run of three or more Latin letters that is not a name or technical term. */
function looksEnglish(text: string): boolean {
  const words = text.match(/[A-Za-z]{3,}/g) ?? [];
  return words.some((w) => !KEEP.has(w.toLowerCase()));
}

// A line holding one of these markers is reviewed and allowed (a unit, a code, a language name written in its own language).
const ALLOW_LINE = /\/\/ i18n-ok|\{\/\* i18n-ok \*\/\}/;
// Strings in this list are allowed anywhere (the names of things the product keeps in Latin script).
const ALLOWED_TEXT = new Set<string>(["Apple Mail", "npm install", "npm run copy:ocr", "Catch Hook", "Custom webhook", "https://  name@email.com  +974..."]);

export function englishInJsx(source: string): string[] {
  const hits: string[] = [];
  const clean = stripComments(source);
  clean.split("\n").forEach((line, i) => {
    if (ALLOW_LINE.test(source.split("\n")[i] ?? "")) return;
    for (const m of line.matchAll(PROP_RE)) {
      const value = (m[3] ?? m[4] ?? "").trim();
      if (value && !ALLOWED_TEXT.has(value) && looksEnglish(value) && /\s|^[A-Z][a-z]+$/.test(value)) hits.push(`${i + 1}: ${m[1]}="${value}"`);
    }
    for (const m of line.matchAll(TEXT_RE)) {
      const value = m[1].trim();
      if (!ALLOWED_TEXT.has(value) && looksEnglish(value) && /\s/.test(value)) hits.push(`${i + 1}: >${value}<`);
    }
    for (const m of line.matchAll(CALL_RE)) {
      const value = m[3].trim();
      if (!ALLOWED_TEXT.has(value) && looksEnglish(value) && /\s/.test(value)) hits.push(`${i + 1}: ${m[1]}("${value}")`);
    }
    for (const m of line.matchAll(META_RE)) {
      const value = m[2].trim();
      if (!ALLOWED_TEXT.has(value) && looksEnglish(value) && /\s/.test(value)) hits.push(`${i + 1}: ${m[1]}: "${value}"`);
    }
    const bare = line.trim();
    if (PROSE_LINE.test(bare) && !CODE_WORD.test(bare) && !NAME_LIST.test(bare) && !ALLOWED_TEXT.has(bare) && looksEnglish(bare)) hits.push(`${i + 1}: ${bare}`);
  });
  return hits;
}

describe("no hard-coded English on screen", () => {
  it("finds English prose in JSX text and visible props", () => {
    expect(englishInJsx('<button aria-label="Close the dialog">x</button>')).toHaveLength(1);
    expect(englishInJsx("<p>Save your changes now</p>")).toHaveLength(1);
    expect(englishInJsx('<p>{t("a.b")}</p><span aria-label={t("a.c")} />')).toHaveLength(0);
    expect(englishInJsx('<b>QR</b><i>vCard CSV</i><code>https://example.com</code>')).toHaveLength(0);
  });

  it("every .tsx file puts its sentences in the catalogue", () => {
    const hits: string[] = [];
    for (const f of files(SRC)) {
      const r = rel(f);
      if (SCAN_SKIP.some((re) => re.test(r))) continue;
      for (const h of englishInJsx(fs.readFileSync(f, "utf8"))) hits.push(`${r}:${h}`);
    }
    expect(hits, "move each sentence to lib/i18n/en and ar (or mark a reviewed line with // i18n-ok)").toEqual([]);
  });
});
