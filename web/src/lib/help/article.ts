// Help articles are Markdown files in web/content/help/<language>/<slug>.md with a small header:
//
//   ---
//   title: Create and edit your card
//   summary: One sentence for the list and for search.
//   audience: personal, company_owner, company_admin, employee
//   pages: /app/cards, /app/qr
//   related: choose-a-design, publish-and-share
//   updated: 2026-11-22
//   ---
//
// This file reads that header and the body; it does not touch the file system (see lib/server/help.ts).
import type { Audience } from "@/lib/guide/types";
import { AUDIENCES } from "@/lib/guide/types";

export interface ArticleMeta {
  slug: string;
  title: string;
  summary: string;
  audience: Audience[];
  /** App pages the article is about; each becomes an "Open this page" link. */
  pages: string[];
  /** Slugs of related articles. */
  related: string[];
  /** The last time the text was reviewed, as YYYY-MM-DD. */
  updated: string;
}
export interface Article extends ArticleMeta {
  body: string;
}

export const REQUIRED_KEYS = ["title", "summary", "audience", "pages", "related", "updated"] as const;

/** The raw header keys and the body of a file, or null when the file has no header. */
export function splitFrontMatter(raw: string): { header: Record<string, string>; body: string } | null {
  const text = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!m) return null;
  const header: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    header[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { header, body: m[2].trim() };
}

function list(v: string | undefined): string[] {
  return (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** Only same-site app pages are kept as "Open this page" targets. */
export function safePage(p: string): boolean {
  return /^\/app(\/[a-z0-9\-/]*)?$/.test(p);
}

export function parseArticle(slug: string, raw: string): Article | null {
  const parts = splitFrontMatter(raw);
  if (!parts) return null;
  const h = parts.header;
  if (!h.title || !h.summary) return null;
  const audience = list(h.audience).filter((a): a is Audience => (AUDIENCES as readonly string[]).includes(a));
  return {
    slug,
    title: h.title,
    summary: h.summary,
    audience,
    pages: list(h.pages).filter(safePage),
    related: list(h.related),
    updated: /^\d{4}-\d{2}-\d{2}$/.test(h.updated ?? "") ? h.updated : "",
    body: parts.body,
  };
}
