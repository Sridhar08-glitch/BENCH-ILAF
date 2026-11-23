import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REQUIRED_KEYS, parseArticle, safePage, splitFrontMatter } from "./article";
import { fillApp, internalLinks, parseHelp, plainText, slugOf } from "./markdown";
import { KNOWN_PAGES } from "./pages";
import { normalise, search, words, type Searchable } from "./search";

const CONTENT = path.resolve(__dirname, "..", "..", "..", "content", "help");
const LANGS = ["en", "ar"] as const;

describe("front matter", () => {
  const raw = "---\ntitle: A title\nsummary: One line.\naudience: personal, employee, nobody\npages: /app/cards, /evil, /app/qr\nrelated: a, b\nupdated: 2026-11-22\n---\n\nBody **text**.\n";

  it("reads the header and the body", () => {
    const a = parseArticle("x", raw)!;
    expect(a.title).toBe("A title");
    expect(a.audience).toEqual(["personal", "employee"]);
    expect(a.pages).toEqual(["/app/cards", "/app/qr"]);
    expect(a.related).toEqual(["a", "b"]);
    expect(a.updated).toBe("2026-11-22");
    expect(a.body).toBe("Body **text**.");
  });

  it("handles Windows line endings and refuses a file with no header", () => {
    expect(parseArticle("x", raw.replace(/\n/g, "\r\n"))?.title).toBe("A title");
    expect(splitFrontMatter("no header")).toBeNull();
    expect(parseArticle("x", "---\ntitle: only\n---\nbody")).toBeNull();
  });

  it("only keeps app pages as open-page targets", () => {
    expect(safePage("/app/cards")).toBe(true);
    expect(safePage("/app/settings/sign-in")).toBe(true);
    expect(safePage("https://example.com")).toBe(false);
    expect(safePage("//evil.com")).toBe(false);
    expect(safePage("/login")).toBe(false);
  });
});

describe("help markdown", () => {
  it("builds headings, paragraphs, lists, steps and tips", () => {
    const blocks = parseHelp("## Make it\n\nFirst line\nsecond line.\n\n1. One\n2. Two\n\n- A\n- B\n\n> Careful\n\n### Small\n");
    expect(blocks.map((b) => b.kind)).toEqual(["h2", "p", "ol", "ul", "tip", "h3"]);
    expect(blocks[0]).toMatchObject({ kind: "h2", id: "make-it" });
    expect(blocks[1]).toMatchObject({ kind: "p" });
    expect((blocks[2] as { items: unknown[] }).items).toHaveLength(2);
    expect((blocks[3] as { items: unknown[] }).items).toHaveLength(2);
  });

  it("bold and safe links only, no raw HTML or script links", () => {
    const [p] = parseHelp("See **this** [page](/app/qr), [site](https://x.com) and [bad](javascript:alert(1)) <b>raw</b>");
    expect(p.kind).toBe("p");
    const inl = (p as { inline: { kind: string; href?: string; text: string }[] }).inline;
    expect(inl.find((i) => i.kind === "bold")?.text).toBe("this");
    expect(inl.filter((i) => i.kind === "link").map((i) => i.href)).toEqual(["/app/qr", "https://x.com"]);
    expect(inl.some((i) => i.kind === "text" && i.text === "bad")).toBe(true);
    expect(inl.some((i) => i.kind === "link" && i.href?.startsWith("javascript"))).toBe(false);
    expect(inl.map((i) => i.text).join("")).toContain("<b>raw</b>");
  });

  it("keeps Arabic headings as anchors", () => {
    expect(slugOf("الخطوات الخمس")).toBe("الخطوات-الخمس");
    expect(slugOf("!!!")).toBe("section");
    const [h] = parseHelp("## الخطوات الخمس");
    expect(h).toMatchObject({ kind: "h2", id: "الخطوات-الخمس" });
  });

  it("fills the product name and never leaves a marker", () => {
    expect(fillApp("Use {{APP}} now", "BENCH")).toBe("Use BENCH now");
  });

  it("plain text drops the marks", () => {
    expect(plainText("## Title\n\n1. **Bold** [link](/app/qr)\n> tip")).toBe("Title Bold link tip");
  });

  it("lists internal links", () => {
    expect(internalLinks("a [x](/app/qr) b [y](https://z.com) c [w](/app/help/foo)")).toEqual(["/app/qr", "/app/help/foo"]);
  });
});

describe("search", () => {
  const items: Searchable[] = [
    { slug: "publish", title: "Publish and share your card", summary: "Your link and the QR code.", audience: ["personal", "employee"], text: "Press Publish. The NFC link can be written to a tag." },
    { slug: "team", title: "Invite your team", summary: "Send invitations.", audience: ["company_owner"], text: "Type email addresses and choose a role." },
    { slug: "ar-publish", title: "نشر بطاقتك ومشاركتها", summary: "رابطك ورمز QR.", audience: [], text: "تبقى البطاقة مسودة حتى تنشرها. اطبع الرمز." },
    { slug: "ar-sign", title: "طرق تسجيل الدخول", summary: "كلمة المرور وGoogle.", audience: ["personal"], text: "الإعدادات الحساب" },
  ];

  it("normalises Arabic marks, alef and yeh shapes, digits and the article", () => {
    expect(normalise("البِطاقَة")).toBe(normalise("بطاقة"));
    expect(normalise("إعدادات")).toBe(normalise("اعدادات"));
    expect(normalise("مساعدى")).toBe(normalise("مساعدي"));
    expect(normalise("مدرسة")).toBe(normalise("مدرسه"));
    expect(normalise("٣٠ يوماً")).toBe("30 يوما");
    expect(normalise("Café   QR!")).toBe("cafe qr");
    expect(words("a ، بطاقة")).toEqual(["بطاقه"]);
  });

  it("finds English by words and word starts, best title first", () => {
    expect(search(items, "publish").map((h) => h.item.slug)).toEqual(["publish"]);
    expect(search(items, "publi")[0].item.slug).toBe("publish");
    expect(search(items, "qr code")[0].item.slug).toBe("publish");
    expect(search(items, "nothing like this")).toEqual([]);
  });

  it("finds Arabic with and without marks and the article", () => {
    expect(search(items, "بطاقه")[0].item.slug).toBe("ar-publish");
    expect(search(items, "البطاقة")[0].item.slug).toBe("ar-publish");
    expect(search(items, "تنشرها")[0].item.slug).toBe("ar-publish");
    expect(search(items, "الاعدادات")[0].item.slug).toBe("ar-sign");
    expect(search(items, "الإعدادات")[0].item.slug).toBe("ar-sign");
  });

  it("an empty query lists everything, and the audience filter keeps guides for everyone", () => {
    expect(search(items, "")).toHaveLength(4);
    expect(search(items, "", "company_owner").map((h) => h.item.slug).sort()).toEqual(["ar-publish", "team"]);
    expect(search(items, "", "personal").map((h) => h.item.slug).sort()).toEqual(["ar-publish", "ar-sign", "publish"]);
  });
});

describe("the help articles on disk", () => {
  const slugs = (lang: string) => fs.readdirSync(path.join(CONTENT, lang)).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)).sort();
  const read = (lang: string, slug: string) => fs.readFileSync(path.join(CONTENT, lang, `${slug}.md`), "utf8");

  it("there are 25 guides and Arabic has exactly the English slugs", () => {
    expect(slugs("en")).toHaveLength(25);
    expect(slugs("ar")).toEqual(slugs("en"));
  });

  for (const lang of LANGS) {
    it(`${lang}: every guide has the full header and a real body`, () => {
      for (const slug of slugs(lang)) {
        const parts = splitFrontMatter(read(lang, slug));
        expect(parts, `${lang}/${slug}`).not.toBeNull();
        for (const k of REQUIRED_KEYS) expect(parts!.header[k], `${lang}/${slug}: ${k}`).toBeTruthy();
        expect(parts!.body.length, `${lang}/${slug}`).toBeGreaterThan(300);
        expect(parseArticle(slug, read(lang, slug)), `${lang}/${slug}`).not.toBeNull();
      }
    });
  }

  it("the Arabic header keys and values that are not text match the English ones", () => {
    for (const slug of slugs("en")) {
      const en = splitFrontMatter(read("en", slug))!.header;
      const ar = splitFrontMatter(read("ar", slug))!.header;
      expect(Object.keys(ar).sort(), slug).toEqual(Object.keys(en).sort());
      for (const k of ["audience", "pages", "related", "updated"]) expect(ar[k], `${slug}: ${k}`).toBe(en[k]);
    }
  });

  for (const lang of LANGS) {
    it(`${lang}: no broken links, no unknown pages, no missing related guides`, () => {
      const all = new Set(slugs(lang));
      for (const slug of slugs(lang)) {
        const a = parseArticle(slug, read(lang, slug))!;
        for (const p of a.pages) expect(KNOWN_PAGES, `${lang}/${slug}: page ${p}`).toContain(p);
        for (const r of a.related) expect(all.has(r), `${lang}/${slug}: related ${r}`).toBe(true);
        for (const link of internalLinks(a.body)) {
          const help = /^\/app\/help\/([a-z0-9-]+)$/.exec(link);
          if (help) expect(all.has(help[1]), `${lang}/${slug}: ${link}`).toBe(true);
          else expect(KNOWN_PAGES, `${lang}/${slug}: ${link}`).toContain(link);
        }
      }
    });

    it(`${lang}: the product name is a placeholder, never typed in`, () => {
      for (const slug of slugs(lang)) expect(read(lang, slug), `${lang}/${slug}`).not.toMatch(/BENCH/);
    });
  }

  it("Arabic guides are written in Arabic", () => {
    for (const slug of slugs("ar")) {
      const a = parseArticle(slug, read("ar", slug))!;
      expect(/[؀-ۿ]/.test(a.title), `${slug} title`).toBe(true);
      expect(/[؀-ۿ]/.test(a.summary), `${slug} summary`).toBe(true);
      expect(/[؀-ۿ]/.test(a.body), `${slug} body`).toBe(true);
    }
  });

  it("every guide for an audience is findable by searching its own title", () => {
    for (const lang of LANGS) {
      const items: Searchable[] = slugs(lang).map((slug) => {
        const a = parseArticle(slug, read(lang, slug))!;
        return { slug, title: a.title, summary: a.summary, audience: a.audience, text: plainText(a.body) };
      });
      for (const it of items) expect(search(items, it.title).map((h) => h.item.slug), `${lang}/${it.slug}`).toContain(it.slug);
    }
  });
});
