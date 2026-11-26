// Self-hosts the fonts the card designs use, so a public card page never asks Google (or any other third party) for anything.
// Copies the latin woff2 files of the @fontsource packages listed below into public/card-fonts, writes the one stylesheet that
// declares them (public/card-fonts/fonts.css) and a small module with its address (src/lib/library/generated/fonts.ts).
// The browser fetches a font file only when a card really uses that family and weight (a @font-face is lazy).
// Runs before `npm run build` (see "prebuild" in package.json). Safe to run again.
//
// Adding a font: install its @fontsource package (exact version), add one line to FAMILIES, run `npm run copy:fonts`.
// A family used by the card CSS but not listed here falls back to the generic family named after it in that CSS.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "card-fonts");

// [family name as the card CSS writes it, @fontsource package, [[weight, style], ...], subsets (default ["latin"])]
// The weights are the ones the design library asks for (Design Pack 2, faces 401 to 500, added Poppins 600, Cormorant
// Garamond 500 italic, Playfair Display 400 italic, Cairo 800, Amiri and IBM Plex Sans Arabic). Cairo and Tajawal are the
// Arabic choices of the card font picker (design.font); the app's own Arabic font (IBM Plex Sans Arabic) is bundled by
// next/font in app/layout.tsx, and listed here as well so a card face that names it never falls back on a public page.
const FAMILIES = [
  ["Plus Jakarta Sans", "plus-jakarta-sans", [[500], [700], [800]]],
  ["Manrope", "manrope", [[400], [500], [700], [800]]],
  ["DM Sans", "dm-sans", [[500], [700]]],
  ["Outfit", "outfit", [[300], [500], [700]]],
  ["Sora", "sora", [[300], [500], [700]]],
  ["Poppins", "poppins", [[500], [600], [700]]],
  ["Montserrat", "montserrat", [[500], [700], [800]]],
  ["Nunito", "nunito", [[600], [800]]],
  ["Playfair Display", "playfair-display", [[600], [700], [900], [400, "italic"], [600, "italic"]]],
  ["DM Serif Display", "dm-serif-display", [[400]]],
  ["Cormorant Garamond", "cormorant-garamond", [[400], [500], [700], [500, "italic"]]],
  ["Lora", "lora", [[500], [700]]],
  ["Fraunces", "fraunces", [[500], [700], [900], [500, "italic"]]],
  ["Bebas Neue", "bebas-neue", [[400]]],
  ["Oswald", "oswald", [[500], [700]]],
  ["Anton", "anton", [[400]]],
  ["Syne", "syne", [[600], [800]]],
  ["Space Grotesk", "space-grotesk", [[400], [500], [700]]],
  ["JetBrains Mono", "jetbrains-mono", [[400], [700]]],
  ["Space Mono", "space-mono", [[400], [700]]],
  ["Caveat", "caveat", [[600], [700]]],
  ["Dancing Script", "dancing-script", [[600], [700]]],
  ["Press Start 2P", "press-start-2p", [[400]]],
  ["Cairo", "cairo", [[400], [600], [700], [800]], ["latin", "arabic"]],
  ["Tajawal", "tajawal", [[500], [700]], ["latin", "arabic"]],
  ["Amiri", "amiri", [[400], [700]], ["latin", "arabic"]],
  ["IBM Plex Sans Arabic", "ibm-plex-sans-arabic", [[300], [400], [600], [700]], ["latin", "arabic"]],
  // Page styles 28 to 77 (scripts/pages/lab). Only the weights those pages use; a browser loads a file only when a card uses it.
  ["Abril Fatface", "abril-fatface", [[400]]],
  ["Alfa Slab One", "alfa-slab-one", [[400]]],
  ["Aref Ruqaa", "aref-ruqaa", [[400], [700]], ["latin", "arabic"]],
  ["Audiowide", "audiowide", [[400]]],
  ["Bagel Fat One", "bagel-fat-one", [[400]]],
  ["Barlow Condensed", "barlow-condensed", [[500], [700]]],
  ["Barlow", "barlow", [[400], [600]]],
  ["Bodoni Moda", "bodoni-moda", [[500], [700], [500, "italic"]]],
  ["Bricolage Grotesque", "bricolage-grotesque", [[300], [700], [800]]],
  ["Bungee", "bungee", [[400]]],
  ["Chakra Petch", "chakra-petch", [[400], [600]]],
  ["Cinzel", "cinzel", [[500], [700]]],
  ["Cormorant SC", "cormorant-sc", [[500], [700]]],
  ["Courier Prime", "courier-prime", [[400], [700]]],
  ["Cutive Mono", "cutive-mono", [[400]]],
  ["DM Mono", "dm-mono", [[400], [500]]],
  ["Figtree", "figtree", [[400], [700]]],
  ["Hanken Grotesk", "hanken-grotesk", [[400], [700]]],
  ["IBM Plex Mono", "ibm-plex-mono", [[400], [600]]],
  ["Instrument Sans", "instrument-sans", [[400], [600]]],
  ["Inter Tight", "inter-tight", [[400], [700], [900]]],
  ["Josefin Sans", "josefin-sans", [[400], [700]]],
  ["Jost", "jost", [[300], [500], [800]]],
  ["Lalezar", "lalezar", [[400]], ["latin", "arabic"]],
  ["Libre Franklin", "libre-franklin", [[500], [600]]],
  ["Lilita One", "lilita-one", [[400]]],
  ["Markazi Text", "markazi-text", [[500], [700]], ["latin", "arabic"]],
  ["Mulish", "mulish", [[400], [700]]],
  ["Newsreader", "newsreader", [[400], [600], [400, "italic"]]],
  ["Noto Kufi Arabic", "noto-kufi-arabic", [[500], [700]], ["latin", "arabic"]],
  ["Noto Naskh Arabic", "noto-naskh-arabic", [[400], [700]], ["latin", "arabic"]],
  ["Old Standard TT", "old-standard-tt", [[400], [700], [400, "italic"]]],
  ["Patrick Hand", "patrick-hand", [[400]]],
  ["Permanent Marker", "permanent-marker", [[400]]],
  ["Poiret One", "poiret-one", [[400]]],
  ["Rakkas", "rakkas", [[400]], ["latin", "arabic"]],
  ["Reem Kufi", "reem-kufi", [[500], [700]], ["latin", "arabic"]],
  ["Saira Stencil One", "saira-stencil-one", [[400]]],
  ["Share Tech Mono", "share-tech-mono", [[400]]],
  ["Shippori Mincho", "shippori-mincho", [[400], [700]]],
  ["Special Elite", "special-elite", [[400]]],
  ["UnifrakturMaguntia", "unifrakturmaguntia", [[400]]],
];

// The Latin range Google and Fontsource use: basic Latin, Latin-1, punctuation, the euro sign and a few symbols.
const LATIN = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";

const ARABIC = "U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC";
const RANGES = { latin: LATIN, arabic: ARABIC };

mkdirSync(out, { recursive: true });
const wanted = new Set(["fonts.css"]);
const faces = [];
let missing = 0;

for (const [family, pkg, variants, subsets = ["latin"]] of FAMILIES) {
  const dir = join(root, "node_modules", "@fontsource", pkg);
  if (!existsSync(join(dir, "package.json"))) {
    console.warn(`copy-card-fonts: @fontsource/${pkg} is not installed (run npm install). ${family} falls back to a system font.`);
    missing += 1;
    continue;
  }
  const version = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version;
  for (const subset of subsets) {
    for (const [weight, style = "normal"] of variants) {
      const from = join(dir, "files", `${pkg}-${subset}-${weight}-${style}.woff2`);
      if (!existsSync(from)) {
        console.warn(`copy-card-fonts: ${pkg} has no ${subset} ${weight} ${style} file. Skipped.`);
        missing += 1;
        continue;
      }
      // The version is part of the file name, so a font update gets a new address and the long browser cache is never stale.
      const name = `${pkg}${subset === "latin" ? "" : "-" + subset}-${version}-${weight}-${style}.woff2`;
      wanted.add(name);
      const dest = join(out, name);
      if (!existsSync(dest) || statSync(dest).size !== statSync(from).size) copyFileSync(from, dest);
      faces.push(
        `@font-face{font-family:"${family}";font-style:${style};font-weight:${weight};font-display:swap;src:url(${name}) format("woff2");unicode-range:${RANGES[subset]}}`,
      );
    }
  }
}

// Remove files of fonts that are no longer listed.
for (const f of readdirSync(out)) if (!wanted.has(f)) rmSync(join(out, f), { force: true });

const css = `/* Generated by scripts/copy-card-fonts.mjs. Do not edit. */\n${faces.join("\n")}\n`;
writeFileSync(join(out, "fonts.css"), css);
const hash = createHash("sha256").update(css).digest("hex").slice(0, 10);
const generated = join(root, "src", "lib", "library", "generated");
mkdirSync(generated, { recursive: true });
writeFileSync(
  join(generated, "fonts.ts"),
  `// Generated by scripts/copy-card-fonts.mjs. Do not edit.\n/** The self-hosted card fonts stylesheet; the hash changes whenever the font list changes. */\nexport const FONTS_CSS_URL = "/card-fonts/fonts.css?v=${hash}";\n`,
);
console.log(`copy-card-fonts: ${faces.length} font files declared in public/card-fonts/fonts.css${missing ? ` (${missing} missing)` : ""}`);
