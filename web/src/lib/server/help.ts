// Reads the help articles from web/content/help/<language>/<slug>.md. Server only.
import fs from "node:fs";
import path from "node:path";
import { parseArticle, type Article } from "@/lib/help/article";
import type { Locale } from "@/lib/i18n";

const DIR = path.join(process.cwd(), "content", "help");
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** The folder for a language, falling back to English when a language has no folder yet. */
function folder(locale: Locale): string {
  const own = path.join(DIR, locale);
  return fs.existsSync(own) ? own : path.join(DIR, "en");
}

export function loadArticle(locale: Locale, slug: string): Article | null {
  if (!SLUG.test(slug)) return null;
  const file = path.join(folder(locale), `${slug}.md`);
  try {
    return parseArticle(slug, fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Every article of a language, in the order of the file names. */
export function loadArticles(locale: Locale): Article[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(folder(locale)).filter((f) => f.endsWith(".md")).sort();
  } catch {
    return [];
  }
  const out: Article[] = [];
  for (const name of names) {
    const a = loadArticle(locale, name.slice(0, -3));
    if (a) out.push(a);
  }
  return out;
}
