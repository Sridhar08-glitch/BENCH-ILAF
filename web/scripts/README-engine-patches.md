# Hand patches in `src/lib/library/generated/engine.js`

`engine.js` is produced by `scripts/build-design-library.mjs`, then patched by `scripts/build-pages.mjs` and `scripts/build-pack2.mjs`.
The Classic faces (1 to 400), their below-card layouts and openings are not written in this repo: `build-design-library.mjs` reads them from
a folder of "design page pieces" (`faces2.js` to `faces6.js`, `dv2.js` to `dv6.js`, `ops2.js` to `ops5.js`, `app3.js`, `card_designs_base25.html`,
`wizard.js`, the css files) that is passed on the command line or in `DESIGN_SRC` and is not committed. Only the glue is here
(`scripts/design-library/`). The old single page `design-reference/ilaf_one_card_designs.html` holds an early copy of many faces
(for example "Scrabble tiles" at line 5904), but it is not what the build reads.

So a full `npm run build:library` (which needs those pieces) would rewrite `engine.js` and drop any change made directly in it.
Two changes were made directly in the generated file. Status:

## 1. "More buttons" block of the page-style layouts (layout number 400 and up) - ported

In `gs()` (the page renderer) the block that lists buttons the layout has no place for now gets `data-fx` on its rows for the page styles,
so the text-font and size rules reach them. The source is `scripts/design-library/engine-tail.js` (the `more` line), and the change is
already made there:

```js
out += '<div class="dv k0' + (brand ? '' : ' harm') + ' more">' + (j >= 400 ? rows(missing).split('<div>').join('<div data-fx>') : rows(missing)) + '</div>';
```

A rebuild keeps it. (Not rebuilt here: the pieces are missing, so the engine was not regenerated to check it.)

## 2. "Scrabble tiles" (face 193), Arabic fallback - NOT portable, must be redone in the face source

The face only made tiles for the letters A to Z, so an Arabic name drew no tiles at all. In the face's `h:function(){...}` in the
Classic face file that holds face 193 (`faces*.js` in the design pieces), two things were changed inside the tile helper `l(c)`:

```js
// before
var f=c.toUpperCase().replace(/[^A-Z]/g,"").slice(0,20), ...
s += '<i class="tk" ...>' + n + '<sub>' + pts[n] + '</sub></i>'
// after
var f=c.toUpperCase().replace(/[^A-Z]/g,"").slice(0,20);
f||(f=c.replace(/<[^>]*>/g,"").replace(/\s+/g,"").slice(0,20));   // no Latin letter: take whatever letters there are
s += '<i class="tk" ...>' + n + (pts[n] ? '<sub>' + pts[n] + '</sub>' : '') + '</i>'   // no point value for letters outside A-Z
```

Search the face file for `Scrabble tiles` and apply the same two edits to the un-minified source before the next rebuild, or re-apply them
to `engine.js` by hand (search for `n:"Scrabble tiles"`). `src/lib/library/editor-matrix.test.ts` (Arabic column) fails if the Arabic name
disappears from the face again.

## Checking after any rebuild

```
npx vitest run src/lib/library          # editor-matrix, text, library tests
```
