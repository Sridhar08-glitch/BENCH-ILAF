// Every editor option against every style, through the real engine. One cell per option and style:
//   ok         the option changes what the style draws (or reaches the text the style gives it)
//   no-effect  the option is on but the style's output does not follow it  (a bug)
//   partial    the option reaches some of the text the style draws but not all of it (a bug)
//   n/a        the option cannot apply to this style and the editor says so (hidden step, locked face, detail not drawn)
// The test fails on every no-effect and partial cell. WRITE_MATRIX=1 also writes the full matrix to design-lab/v3/editor-matrix.{json,md}.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COLOUR_COUNT, FACE_COUNT, INTRO_COUNT, TOP_COUNT, defaultDesign, belowOfTop, topInfo } from "./index";
import { renderCardPage } from "./render";
import { fieldsOf } from "./fieldsUsed";
import { reachedText } from "./marked-text";
import { TOP_SLOTS } from "./fields";
import { FONTS, FONT_FACE, TEXT_CSS, fontStack, isFontLocked } from "./text";
import type { CardPageData } from "./types";
import type { Design } from "@/lib/types";

const WEB = path.join(__dirname, "..", "..", "..");
const MARK = { name: "Sara Al Mansoori", title: "TITLEMARK Designer", company: "COMPANYMARK Studio", address: "ADDRMARK Street", bio: "BIOMARK words about me." };
const BUTTONS = [
  { kind: "Mobile", value: "+974 5512 3344" }, { kind: "WhatsApp", value: "+974 5512 3344" }, { kind: "Email", value: "x@example.test" },
  { kind: "Website", value: "x.example.test" }, { kind: "Location", value: "ADDRMARK Street" }, { kind: "Instagram", value: "handle" },
  { kind: "LinkedIn", value: "handle" }, { kind: "Calendly", value: "handle" }, { kind: "X", value: "handle" }, { kind: "YouTube", value: "handle" },
  { kind: "TikTok", value: "handle" }, { kind: "SMS", value: "+974 5512 3344" },
];
const base: CardPageData = {
  name: MARK.name, title: MARK.title, company: MARK.company, address: MARK.address, bio: MARK.bio,
  photoUrl: "https://m.test/PHOTOMARK.jpg", coverUrl: "https://m.test/COVERMARK.jpg", saveContact: true, publicUrl: "https://x.test/c/x",
  design: defaultDesign(), brand: null, locale: "en", items: BUTTONS.slice(0, 8),
};
const palette = { bg: "#123456", bg2: "#234567", fg: "#FFFFFF", acc: "#ABCDEF", on: "#000000" };

const designOf = (top: number, face: number, patch: Partial<Design> = {}): Design => ({ ...defaultDesign(), face, top, below: top > 0 ? belowOfTop(top) : 1, intro: 0, ...patch });
const draw = (d: Design, patch: Partial<CardPageData> = {}) => renderCardPage({ ...base, ...patch, design: d }, "live");

// ---- the style sheet of every page style, to see which card colour variables it really uses
const pagesCss = fs.readFileSync(path.join(WEB, "public", "card-library", "pages.css"), "utf8");
const cssByTop = new Map<number, string>();
for (const m of pagesCss.matchAll(/[^{}]*\.cfl \.pg-t(\d+)[^{}]*\{[^{}]*\}/g)) cssByTop.set(Number(m[1]), (cssByTop.get(Number(m[1])) ?? "") + m[0]);
const COLOUR_VARS = /var\(--(cbg2?|cfg|cacc|con)[,)]/;

type Cell = "ok" | "no-effect" | "partial" | "n/a";
interface Row {
  top: number;
  face: number;
  name: string;
  group: string;
  cells: Record<string, Cell>;
  notes: string[];
}

const OPTIONS = ["font", "font-arabic", "size", "colour", "company-colours", "below", "intro", "photo", "cover", "foot", "brand-colours", "bio", "address", "buttons-1", "buttons-12", "long-name", "arabic"] as const;
type Option = (typeof OPTIONS)[number];

function rowOf(top: number, face: number): Row {
  const info = top > 0 ? topInfo(top) : null;
  const d0 = designOf(top, face);
  const f = fieldsOf(d0);
  const row: Row = { top, face, name: info ? info.name : `face ${face}`, group: info ? info.style : "Classic", cells: {}, notes: [] };
  const set = (k: Option, c: Cell, note?: string) => {
    row.cells[k] = c;
    if (c !== "ok" && c !== "n/a" && note) row.notes.push(`${k}: ${note}`);
  };
  const h0 = draw(d0);

  // font and size: the wrapper gets the class and variables, and the text the style draws follows them
  const textReach = (font: string, size: number): { cell: Cell; note?: string } => {
    const r = draw(designOf(top, face, { font, size }));
    const classes = r.wrapClass.split(" ");
    if (font !== FONT_FACE && top === 0 && isFontLocked(face)) return { cell: classes.includes("tx-font") ? "no-effect" : "n/a", note: "locked face still got the font" };
    if (font !== FONT_FACE && !classes.includes("tx-font")) return { cell: "no-effect", note: "no tx-font class" };
    if (size !== 100 && !classes.includes("tx-size")) return { cell: "no-effect", note: "no tx-size class" };
    if (font !== FONT_FACE && r.pageVars["--tf"] !== fontStack(font)) return { cell: "no-effect", note: "--tf missing" };
    if (top === 0) return { cell: "ok" };
    const words = reachedText(r.html);
    const lacking: string[] = [];
    if (!/Sara|Mansoori/.test(words)) lacking.push("name");
    if (f.title && !words.includes("TITLEMARK")) lacking.push("title");
    if (f.company && !words.includes("COMPANYMARK")) lacking.push("company");
    if (f.bio && !words.includes("BIOMARK")) lacking.push("bio");
    if (!/\+974|x@example|x\.example|Call|Email|Website|WhatsApp|ADDRMARK/.test(words) && (TOP_SLOTS[top - 1] ?? 0) > 0) lacking.push("buttons");
    if (lacking.length === 0) return { cell: "ok" };
    return { cell: lacking.length >= 3 || lacking.includes("name") ? "no-effect" : "partial", note: `text not reached: ${lacking.join(", ")}` };
  };
  const worst = (cs: { cell: Cell; note?: string }[]) => cs.find((c) => c.cell === "no-effect") ?? cs.find((c) => c.cell === "partial") ?? cs.find((c) => c.cell === "n/a") ?? cs[0];
  const w = worst(FONTS.filter((x) => x.script === "latin").map((x) => textReach(x.key, 100)));
  set("font", w.cell, w.note);
  const ar = worst(FONTS.filter((x) => x.script === "arabic").map((x) => textReach(x.key, 100)));
  set("font-arabic", ar.cell, ar.note);
  const sz = worst([60, 150].map((s) => textReach(FONT_FACE, s)));
  set("size", sz.cell, sz.note);

  // colourway: the four colourways give different card colours and the style's own rules use them
  const colourHtml = Array.from({ length: COLOUR_COUNT }, (_, c) => draw(designOf(top, face, { colour: c })).html);
  const colourVars = (h: string) => /--cbg:([^;"]+)/.exec(h)?.[1] ?? "";
  const differs = new Set(colourHtml.map(colourVars)).size > 1;
  if (top === 0) set("colour", differs || new Set(colourHtml).size > 1 ? "ok" : "no-effect", "colourways draw the same");
  else if (!differs) set("colour", "no-effect", "the four colourways give the same colour variables");
  else if (!COLOUR_VARS.test(cssByTop.get(top) ?? "")) set("colour", "no-effect", "the style's rules use none of --cbg --cbg2 --cfg --cacc --con");
  else set("colour", "ok");
  const co = draw(designOf(top, face, { colour: 4 }), { brand: { companyName: "Studio", logoUrl: null, palette } });
  set("company-colours", /#123456/i.test(co.html) || /rgb\(18, ?52, ?86\)/.test(co.html) ? "ok" : "no-effect", "company palette not used");

  // the layout under the card
  if (top > 0) set("below", "n/a", "a page style brings its own button layout; the step is hidden");
  else set("below", draw(designOf(0, face, { below: 2 })).html !== draw(designOf(0, face, { below: 3 })).html ? "ok" : "no-effect", "layouts draw the same");

  // the opening animation
  const i1 = draw(designOf(top, face, { intro: 1 }));
  const i2 = draw(designOf(top, face, { intro: Math.min(INTRO_COUNT, 405) }));
  set("intro", i1.html !== i2.html && /in-[\w-]+/.test(i2.html) ? "ok" : "no-effect", "the opening names do not change the markup");

  // switches
  const noPhoto = draw(designOf(top, face, { photo: false }));
  set("photo", !f.photo ? "n/a" : h0.html.includes("PHOTOMARK") && !noPhoto.html.includes("PHOTOMARK") ? "ok" : "no-effect", "photo switch does not remove the photo");
  const noCover = draw(d0, { coverUrl: null });
  set("cover", !f.cover ? "n/a" : h0.html.includes("COVERMARK") && !noCover.html.includes("COVERMARK") ? "ok" : "no-effect", "cover picture does not follow the card");
  const footOn = draw(designOf(top, face, { foot: true }));
  const footOff = draw(designOf(top, face, { foot: false }));
  const footText = (h: string) => /class="foot">[^<s][^<]*</.test(h);
  set("foot", footText(footOn.html) && !footText(footOff.html) ? "ok" : "no-effect", "foot switch changes nothing");
  set("brand-colours", draw(designOf(top, face, { brand_colors: true })).html !== draw(designOf(top, face, { brand_colors: false })).html ? "ok" : "no-effect", "brand colours change nothing");

  // content: empty and full
  set("bio", !f.bio ? "n/a" : h0.html.includes("BIOMARK") && !draw(d0, { bio: "" }).html.includes("BIOMARK") ? "ok" : "no-effect", "intro text does not follow the card");
  const noAddr = draw(d0, { address: "", items: base.items.filter((x) => x.kind !== "Location") });
  set("address", !f.address ? "n/a" : h0.html.includes("ADDRMARK") && !noAddr.html.includes("ADDRMARK") ? "ok" : "no-effect", "address does not follow the card");
  const count = (h: string) => new Set(Array.from(h.matchAll(/data-i="(\d+)"/g), (m) => m[1])).size;
  const dirty = (h: string) => /undefined|NaN|\[object/.test(h);
  const one = draw(d0, { items: BUTTONS.slice(0, 1) });
  const many = draw(d0, { items: BUTTONS });
  set("buttons-1", count(one.html) >= 1 && !dirty(one.html) ? "ok" : "no-effect", "one button is not drawn cleanly");
  set("buttons-12", count(many.html) >= Math.min(12, top > 0 ? TOP_SLOTS[top - 1] || 1 : 1) && !dirty(many.html) ? "ok" : "no-effect", "twelve buttons are not all drawn");
  const long = draw(d0, { name: "Abdelrahman Mohammed Al Sulaiman Al Mansoori Bin Rashid" });
  // the words of a face as plain text: some faces set the name in capitals or one letter at a time
  const plain = (h: string) => h.replace(/<svg.*?<\/svg>/gs, "").replace(/<sub>.*?<\/sub>/g, "").replace(/<[^>]*>/g, "").replace(/\s+/g, "").toLowerCase();
  set("long-name", /abdelrahman|rashid|sulaiman/.test(plain(long.html)) && !dirty(long.html) ? "ok" : "no-effect", "a long name is not drawn");
  const arb = draw(d0, { name: "نورة الكواري", title: "مستشارة أعمال", company: "مجموعة الخليج", bio: "أساعد الشركات", address: "الدوحة", locale: "ar" });
  set("arabic", /نورة|الكواري/.test(plain(arb.html)) && (/dir="rtl"/.test(arb.html) || /class="ar"/.test(arb.html) || top === 0) ? "ok" : "no-effect", "Arabic text is not set right to left");
  return row;
}

const rows: Row[] = [];

describe("editor options against every style", () => {
  it("builds the matrix for every page style and face", () => {
    for (let t = 1; t <= TOP_COUNT; t++) rows.push(rowOf(t, 1));
    for (let f = 1; f <= FACE_COUNT; f++) rows.push(rowOf(0, f));
    expect(rows.length).toBe(TOP_COUNT + FACE_COUNT);
    if (process.env.WRITE_MATRIX) {
      const dir = path.join(WEB, "..", "design-lab", "v3");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "editor-matrix.json"), JSON.stringify(rows));
      const groups = [...new Set(rows.map((r) => r.group))];
      const lines = ["# Editor options x styles", "", "Made by `src/lib/library/editor-matrix.test.ts` (WRITE_MATRIX=1). Cells: ok, no-effect, partial, n/a.", "", "| group | styles | " + OPTIONS.join(" | ") + " |", "| --- | --- | " + OPTIONS.map(() => "---").join(" | ") + " |"];
      for (const g of groups) {
        const rs = rows.filter((r) => r.group === g);
        lines.push(`| ${g} | ${rs.length} | ` + OPTIONS.map((o) => {
          const c = (k: Cell) => rs.filter((r) => r.cells[o] === k).length;
          return `${c("ok")} ok` + (c("no-effect") ? `, ${c("no-effect")} no-effect` : "") + (c("partial") ? `, ${c("partial")} partial` : "") + (c("n/a") ? `, ${c("n/a")} n/a` : "");
        }).join(" | ") + " |");
      }
      const bad = rows.filter((r) => Object.values(r.cells).some((c) => c === "no-effect" || c === "partial"));
      lines.push("", `Styles with a broken cell: ${bad.length} of ${rows.length}`, "");
      for (const r of bad.slice(0, 400)) lines.push(`- ${r.top > 0 ? `top ${r.top}` : `face ${r.face}`} (${r.name}): ${r.notes.join("; ")}`);
      fs.writeFileSync(path.join(dir, "editor-matrix.md"), lines.join("\n") + "\n");
    }
  }, 600_000);

  it("has no option that does nothing on any style", () => {
    const bad = rows.filter((r) => Object.values(r.cells).some((c) => c === "no-effect" || c === "partial"));
    expect(bad.map((r) => `${r.top || "face " + r.face}: ${r.notes.join("; ")}`).slice(0, 40)).toEqual([]);
  });

  it("gives the text settings a stylesheet rule for the marked text of page styles", () => {
    expect(TEXT_CSS).toContain("[data-fx]");
    expect(TEXT_CSS).toContain("font-family:var(--tf)");
    expect(TEXT_CSS).toContain("zoom:calc(var(--ts,1)*var(--fz,1))");
  });
});
