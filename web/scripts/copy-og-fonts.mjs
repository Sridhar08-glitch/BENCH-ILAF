// Prepares the font files the share-preview image (/c/<code>/og.png) is drawn with, in public/og-fonts.
// The image is composed on the server with sharp, whose text engine (Pango) shapes Arabic correctly but only reads plain
// TrueType/OpenType files, not WOFF. The @fontsource packages ship WOFF, so each file is unpacked here (a WOFF is the
// same font tables, each one zlib-compressed) into a .ttf. Poppins draws Latin letters and digits, Cairo draws Arabic.
// Runs before `npm run build` (see "prebuild" in package.json). Safe to run again.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "og-fonts");

/** WOFF 1.0 bytes in, sfnt (TTF/OTF) bytes out. */
export function woffToSfnt(buf) {
  if (buf.toString("latin1", 0, 4) !== "wOFF") throw new Error("not a WOFF file");
  const flavor = buf.readUInt32BE(4);
  const numTables = buf.readUInt16BE(12);
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const o = 44 + i * 20;
    const tag = buf.toString("latin1", o, o + 4);
    const offset = buf.readUInt32BE(o + 4);
    const compLength = buf.readUInt32BE(o + 8);
    const origLength = buf.readUInt32BE(o + 12);
    const checksum = buf.readUInt32BE(o + 16);
    const raw = buf.subarray(offset, offset + compLength);
    tables.push({ tag, checksum, data: compLength < origLength ? inflateSync(raw) : raw });
  }
  tables.sort((a, b) => (a.tag < b.tag ? -1 : 1));
  const headerSize = 12 + 16 * numTables;
  let pos = headerSize;
  const dirs = tables.map((t) => {
    const entry = { ...t, offset: pos };
    pos += (t.data.length + 3) & ~3;
    return entry;
  });
  const sfnt = Buffer.alloc(pos);
  sfnt.writeUInt32BE(flavor, 0);
  sfnt.writeUInt16BE(numTables, 4);
  const pow = 2 ** Math.floor(Math.log2(numTables));
  sfnt.writeUInt16BE(pow * 16, 6);
  sfnt.writeUInt16BE(Math.log2(pow), 8);
  sfnt.writeUInt16BE(numTables * 16 - pow * 16, 10);
  dirs.forEach((t, i) => {
    const o = 12 + i * 16;
    sfnt.write(t.tag, o, "latin1");
    sfnt.writeUInt32BE(t.checksum, o + 4);
    sfnt.writeUInt32BE(t.offset, o + 8);
    sfnt.writeUInt32BE(t.data.length, o + 12);
    t.data.copy(sfnt, t.offset);
  });
  return sfnt;
}

const FILES = [
  ["poppins", "poppins-latin-500-normal"],
  ["poppins", "poppins-latin-700-normal"],
  ["cairo", "cairo-arabic-500-normal"],
  ["cairo", "cairo-arabic-700-normal"],
];

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  mkdirSync(out, { recursive: true });
  let missing = 0;
  for (const [pkg, name] of FILES) {
    const from = join(root, "node_modules", "@fontsource", pkg, "files", `${name}.woff`);
    if (!existsSync(from)) {
      console.warn(`copy-og-fonts: ${from} is missing (run npm install). Share previews fall back to system fonts.`);
      missing += 1;
      continue;
    }
    writeFileSync(join(out, `${name}.ttf`), woffToSfnt(readFileSync(from)));
  }
  console.log(`copy-og-fonts: ${FILES.length - missing} font files in public/og-fonts`);
}
