// Three faces draw the name one letter per tile: "Ransom note" (62), "Split-flap board" (97) and "Scrabble tiles" (193).
// Arabic letters change shape by their neighbours, so a word cut into tiles shows isolated letters in the wrong order.
// The engine (generated, and its face source is not in this repo) cannot be changed here, so after it has drawn the card the
// tiles of an Arabic word are put back into one tile: the word is shaped and read right to left inside it.
import { hasArabic } from "@/lib/card/bidi";

const ONE = '[^<>]{1,2}';
/** The word inside a tile: whole word, joined, with no letter spacing. */
const WORD_TILE = "width:auto;min-width:0;padding-inline:.3em;letter-spacing:0;white-space:nowrap";

/** Ransom note: <u><i class="c0" style="...">X</i>...</u> one <u> per word. */
const RANSOM = new RegExp(`<u>((?:<i class="c\\d"[^>]*>${ONE}</i>)+)</u>`, "g");
/** Split-flap: <b class="fp">X</b> in a row. */
const FLAP = new RegExp(`(?:<b class="fp">${ONE}</b>)+`, "g");
/** Scrabble: <i class="tk" style="width:..;height:..;font-size:..">X<sub>n</sub></i> in a row. */
const SCRABBLE = new RegExp(`(?:<i class="tk" style="[^"]*">${ONE}(?:<sub>\\d+</sub>)?</i>)+`, "g");

const textOf = (tiles: string) => tiles.replace(/<sub>\d+<\/sub>/g, "").replace(/<[^>]*>/g, "");

/** Put the tiles of every Arabic word of a drawn card page back into one tile per word. A page without Arabic is returned as it was. */
export function joinArabicTiles(html: string): string {
  if (!hasArabic(html)) return html;
  let out = html;
  if (out.includes('<i class="c')) {
    out = out.replace(RANSOM, (all, tiles: string) => {
      const word = textOf(tiles);
      if (!hasArabic(word)) return all;
      const open = /^<i class="c\d"[^>]*>/.exec(tiles)![0];
      return `<u>${open}${word}</i></u>`;
    });
    // The words of an all-Arabic name run from the right.
    out = out.replace(/<div class="n">(<u><i class="c\d"[^>]*>[^<]+<\/i><\/u>(?:<u>.*?<\/u>)*)<\/div>/g, (all, words: string) => (hasArabic(textOf(words)) ? `<div class="n" dir="rtl">${words}</div>` : all));
  }
  if (out.includes('<b class="fp">')) {
    out = out.replace(FLAP, (tiles) => {
      const word = textOf(tiles);
      return hasArabic(word) ? `<b class="fp" style="${WORD_TILE}">${word}</b>` : tiles;
    });
  }
  if (out.includes('<i class="tk" style=')) {
    out = out.replace(SCRABBLE, (tiles) => {
      const word = textOf(tiles);
      if (!hasArabic(word)) return tiles;
      const style = /^<i class="tk" style="([^"]*)"/.exec(tiles)![1].replace(/width:[^;]*;?/, "");
      return `<i class="tk" style="${style};${WORD_TILE}">${word}</i>`;
    });
  }
  return out;
}
