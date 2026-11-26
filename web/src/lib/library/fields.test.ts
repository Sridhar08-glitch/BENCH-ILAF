// Which of the owner's details each design draws. The table in generated/fields.ts is made by this test
// (run with WRITE_FIELDS=1 after the design library changes) and checked against a fresh render on every run.
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { FACE_COUNT, TOP_COUNT, defaultDesign } from "./index";
import { renderCardPage } from "./render";
import { FACE_FIELDS, TOP_FIELDS } from "./fields";
import type { CardPageData } from "./types";

const M = { title: "TITLEMARKQ", company: "COMPANYMARKQ", address: "ADDRMARKQ", bio: "BIOMARKQ", photo: "PHOTOMARKQ", cover: "COVERMARKQ" };
const data: CardPageData & { bio?: string } = {
  name: "NAMEMARKQ", title: M.title, company: M.company, address: M.address, bio: M.bio,
  photoUrl: `https://m.test/${M.photo}.jpg`, coverUrl: `https://m.test/${M.cover}.jpg`, saveContact: true, publicUrl: "https://x.test/c/x",
  design: defaultDesign(), brand: null, locale: "en",
  items: [{ kind: "Mobile", value: "+974 5512 3344" }, { kind: "Email", value: "x@example.test" }],
};
/** title 1, company 2, address 4, bio 8, photo 16, cover 32 */
function mask(raw: string): number {
  // The back of the card (QR and company line) is not what the owner sees first.
  const html = raw.replace(/<div class="face back">[\s\S]*?<div class="bk2">[\s\S]*?<\/div><\/div>/g, "");
  return (html.includes(M.title) ? 1 : 0) | (html.includes(M.company) ? 2 : 0) | (html.includes(M.address) ? 4 : 0) | (html.includes(M.bio) ? 8 : 0) | (html.includes(M.photo) ? 16 : 0) | (html.includes(M.cover) ? 32 : 0);
}
const draw = (design: object) => renderCardPage({ ...data, design: { ...defaultDesign(), ...design } as never }, "thumb").html;
const faces = () => Array.from({ length: FACE_COUNT }, (_, i) => mask(draw({ face: i + 1, top: 0, below: 1 })));
const tops = () => Array.from({ length: TOP_COUNT }, (_, i) => mask(draw({ face: 1, top: i + 1, below: 401 + i })));

describe("design fields table", () => {
  if (process.env.WRITE_FIELDS) {
    it("writes the table", () => {
      const src = `// Made by fields.test.ts (WRITE_FIELDS=1). For every face and header: which details it draws.\n// Bits: 1 title, 2 company, 4 address, 8 intro text, 16 photo, 32 cover image.\nexport const FACE_FIELDS: readonly number[] = ${JSON.stringify(faces())};\nexport const TOP_FIELDS: readonly number[] = ${JSON.stringify(tops())};\n`;
      fs.writeFileSync(new URL("./fields.ts", import.meta.url), src);
    });
    return;
  }
  it("matches a fresh render of every face and header", () => {
    expect(FACE_FIELDS).toEqual(faces());
    expect(TOP_FIELDS).toEqual(tops());
  });
});
