/* The page renderer. Pure string work, no DOM and no window, so it runs on the server for the first byte of the
   public page and in the browser for the live editor preview. */
var KEYS = {Mobile: 'mobile', Landline: 'tel', WhatsApp: 'wa', Email: 'mail', Website: 'web', Location: 'map', Instagram: 'ig', LinkedIn: 'in', Facebook: 'fb', X: 'x', YouTube: 'yt', GitHub: 'gh', Calendly: 'cal'};
/* The layouts below the card were drawn for 12 fixed places. These are the kinds each place prefers. */
var PREFS = [['Mobile', 'Landline'], ['WhatsApp', 'SMS', 'Telegram'], ['Email'], ['Website'], ['Location'], ['Instagram'], ['LinkedIn'], ['Facebook'], ['X'], ['YouTube'], ['GitHub'], ['Calendly']];
/* Buttons that fit no place go to the empty places in this order. */
var FILL = [5, 6, 7, 8, 9, 10, 11, 3, 4, 1, 0, 2];
var PHONE_KINDS = ['Mobile', 'Landline', 'WhatsApp'];

function lum(h) {
  var r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}
function pvars(p) {
  var q = PAL[p];
  return '--cbg:' + q.bg + ';--cbg2:' + q.bg2 + ';--cfg:' + q.fg + ';--cacc:' + q.acc + ';--con:' + q.on + ';';
}
function pageVarsOf(p) {
  var q = PAL[p];
  return {'--pgbg': q.bg2, '--pgfg': q.fg, '--pacc': q.acc, '--pon': q.on};
}
function enc(svg) {
  return 'data:image/svg+xml,' + encodeURIComponent(svg).replace(/[()']/g, function (c) { return '%' + c.charCodeAt(0).toString(16).toUpperCase(); });
}
/* a plain picture made of the card's own colours, for faces that show a cover when the card has none */
function coverArt(n, q) {
  var open = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" preserveAspectRatio="xMidYMid slice">';
  var grad = '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + q.acc + '"/><stop offset="1" stop-color="' + q.bg2 + '"/></linearGradient></defs><rect width="800" height="500" fill="url(#g)"/>';
  var art = [
    '<circle cx="640" cy="110" r="230" fill="' + q.fg + '" opacity=".12"/><circle cx="120" cy="470" r="170" fill="' + q.fg + '" opacity=".1"/>',
    '<path d="M0 360C160 280 300 440 460 360S700 300 800 360V500H0z" fill="' + q.fg + '" opacity=".14"/><circle cx="170" cy="130" r="90" fill="' + q.fg + '" opacity=".12"/>',
    '<path d="M-40 500 340 -20h120L80 500zM360 500 740 -20h120L480 500z" fill="' + q.fg + '" opacity=".1"/>'
  ][n];
  return enc(open + grad + art + '</svg>');
}
function cssUrl(u) {
  return encodeURI(u).replace(/[()']/g, function (c) { return '%' + c.charCodeAt(0).toString(16).toUpperCase(); });
}

/* "use brand colours": the app works out each button's chip colour (bc) and the icon colour on it (bf) against the page.
   A button without a brand colour keeps the card's accent. */
function makeItem(raw, x, brand) {
  var bc = /^#[0-9a-f]{6}$/i.test(raw.bc || '') ? raw.bc.toUpperCase() : /^[0-9a-f]{6}$/i.test(raw.hex || '') ? '#' + raw.hex.toUpperCase() : '';
  var own = brand && bc;
  var bf = own ? (/^#[0-9a-f]{6}$/i.test(raw.bf || '') ? raw.bf.toUpperCase() : lum(bc) > 0.62 ? '#0F172A' : '#FFFFFF') : '';
  return {
    x: x, kind: raw.kind, k: KEYS[raw.kind] || String(raw.kind).toLowerCase(), g: raw.group,
    l: esc(raw.label), s: esc(raw.short), v: esc(raw.value),
    st: '--mc:' + (own ? bc : 'var(--pacc)') + (own && bf !== '#FFFFFF' && bf !== '#0F172A' ? ';--mf:' + bf : ''), dot: own ? bc : 'var(--pacc)', ink: own ? bf : 'var(--pon)', lt: !!own && lum(bf) < 0.5,
    bc: own ? bc : '', bf: bf,
    ih: raw.iconHtml || '', h: esc(raw.href || ''), nt: !!raw.newTab, z: false
  };
}
function ghostItem() {
  return {x: -1, kind: '', k: '', g: '', l: GHOST, s: GHOST, v: GHOST, st: '', dot: '', ink: '', lt: false, bc: '', bf: '', ih: '', h: '', nt: false, z: true};
}

/* Put the card's buttons into the 12 places. Buttons beyond the 12 are listed under the layout (see belowHtml). */
function placeItems(items) {
  var slots = [], left = items.slice(), s, n;
  for (s = 0; s < 12; s++) slots.push(null);
  for (s = 0; s < 12; s++) {
    for (n = 0; n < left.length; n++) {
      if (PREFS[s].indexOf(left[n].kind) > -1) { slots[s] = left.splice(n, 1)[0]; break; }
    }
  }
  for (s = 0; s < 12 && left.length; s++) {
    if (!slots[FILL[s]]) slots[FILL[s]] = left.shift();
  }
  return slots.map(function (it) { return it || ghostItem(); });
}

function setup(inp) {
  var p = inp.person, d = inp.design, brand = !!d.brand_colors;
  MODE = inp.mode || 'live';
  var made = inp.items.map(function (it, x) { return makeItem(it, x, brand); });
  var placed = placeItems(made);
  ITEMS.length = LIVE.length = CT.length = SO.length = WE.length = 0;
  placed.forEach(function (it) { ITEMS.push(it); });
  made.forEach(function (it) {
    LIVE.push(it);
    (it.g === 'c' ? CT : it.g === 's' ? SO : WE).push(it);
  });
  var firstOf = function (kinds) {
    for (var k = 0; k < kinds.length; k++) {
      for (var n = 0; n < inp.items.length; n++) if (inp.items[n].kind === kinds[k]) return n;
    }
    return -1;
  };
  var ph = firstOf(PHONE_KINDS), em = firstOf(['Email']), wb = firstOf(['Website']);
  P = {
    name: esc(p.name), first: esc(p.first), last: esc(p.last), title: esc(p.title), company: esc(p.company),
    addr: esc(p.address), ini: esc(p.initials), mono: esc((p.initials || '').charAt(0)),
    phone: ph > -1 ? made[ph].v : '', email: em > -1 ? made[em].v : '', web: wb > -1 ? made[wb].v : '',
    phoneX: ph, emailX: em, link: esc((inp.publicUrl || '').replace(/^https?:\/\//, '').replace(/\/$/, ''))
  };
  PH = P.phone ? L('phone', P.phone) : '';
  EM = P.email ? L('mail', P.email) : '';
  WB = P.web ? L('globe', P.web) : '';
  AD = P.addr ? L('pin', P.addr) : '';
  PHOTO = d.photo && p.photoUrl ? esc(p.photoUrl) : '';
  var q = qrOf(inp.qr);
  QRSVG = q;
  var pal = PAL[inp.palette ? companyColours(inp.palette) : D[d.face - 1].p[d.colour]];
  var cv = p.coverUrl ? esc(cssUrl(p.coverUrl)) : '';
  IMG.c = [cv || coverArt(0, pal), cv || coverArt(1, pal), cv || coverArt(2, pal)];
}
function qrOf(qr) {
  var t = qr.size;
  return '<svg viewBox="0 0 ' + t + ' ' + t + '" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="' + t + '" height="' + t + '" fill="#fff"/><path d="' + qr.d + '" fill="#0B0B0B"/></svg>';
}

/* The company's own colours sit in one extra place at the end of the colour list (used when the design says colour 4). */
function companyColours(q) {
  if (companyColours.at === undefined) companyColours.at = PAL.length;
  PAL[companyColours.at] = {name: 'Brand', bg: q.bg, bg2: q.bg2, fg: q.fg, acc: q.acc, on: q.on};
  return companyColours.at;
}

function guard(fn) {
  try { return fn(); } catch (e) { return ''; }
}
function cardHtml(f, pi, flipped) {
  return '<div class="card' + (flipped ? ' flipped' : '') + '" style="' + pvars(pi) + '" role="button" tabindex="0" aria-label="Flip card"><div class="inner"><div class="face d' + (f + 1) + ' tv0"><div class="fx"></div>' + guard(D[f].h) + '</div>'
    + '<div class="face back"><div class="qrt">' + QRSVG + '</div><div class="bk1">Scan to save my contact</div><div class="bk2">' + P.company + '</div></div></div></div>';
}
/* The layouts after the first 12 colour their buttons from --pacc and --pon. With brand colours on, each button's own
   link element gets its chip colours in those variables (and as --bc / --bf), so everything drawn inside it follows. */
function brandTint(h) {
  return h.replace(/<a\b[^>]*\sdata-i="(\d+)"[^>]*>/g, function (tag, n) {
    var it = null, k;
    for (k = 0; k < LIVE.length; k++) if (String(LIVE[k].x) === n) { it = LIVE[k]; break; }
    if (!it || !it.bc) return tag;
    var v = '--bc:' + it.bc + ';--bf:' + it.bf + ';--pacc:' + it.bc + ';--pon:' + it.bf + ';';
    return /\sstyle="/.test(tag) ? tag.replace(/\sstyle="/, ' style="' + v) : tag.replace(/>$/, ' style="' + v + '">');
  });
}
function belowHtml(j, brand) {
  var h = guard(DV[j].h);
  h = h.replace(/<a [^>]*data-z="1"[^>]*>[\s\S]*?<\/a>/g, '');
  var leaks = h.split(GHOST).length - 1;
  h = h.split(GHOST).join('');
  if (brand && j >= 12) h = brandTint(h);
  var out = '<div class="dv dv' + j + ' k0' + (brand ? '' : ' harm') + '">' + h + '</div>';
  /* every button stays reachable, even in a layout that has no place for it */
  if (h.indexOf('data-tab') < 0) {
    var missing = LIVE.filter(function (i) { return h.indexOf('data-i="' + i.x + '"') < 0; });
    if (missing.length) out += '<div class="dv k0' + (brand ? '' : ' harm') + ' more">' + rows(missing) + '</div>';
  }
  return {html: out, leaks: leaks};
}

/**
 * The whole card page for one card and design: card, Save contact button, area below and footer.
 * Returns the markup that goes inside the .cfl wrapper, the page colours for that wrapper, and the
 * card colours that were used.
 */
export function renderPage(inp) {
  setup(inp);
  var d = inp.design, f = d.face - 1, pi = inp.palette ? companyColours(inp.palette) : D[f].p[d.colour], thumb = MODE === 'thumb';
  var b = belowHtml(d.below - 1, !!d.brand_colors);
  var ops = d.intro > 0 ? OPS[d.intro - 1][0] : '';
  var brand = inp.brand && inp.brand.logoUrl ? '<img class="blogo" src="' + esc(inp.brand.logoUrl) + '" alt="' + esc(inp.brand.companyName) + '">' : '';
  var save = !inp.saveContact ? '' : thumb
    ? '<div class="sv">' + ic('adduser') + 'Save contact</div>'
    : '<button type="button" class="sv" data-save>' + ic('adduser') + 'Save contact</button>';
  var html = '<div class="pg ls-rise">' + brand
    + '<div class="stg' + (ops ? ' in-' + ops : '') + '" style="' + pvars(pi) + '"><div class="ov"><i></i><i></i><i></i><i></i><i></i><i></i></div>' + cardHtml(f, pi, !!inp.flipped) + '</div>'
    + (thumb ? '' : '<div class="hint">Tap the card to flip it</div>')
    + save + b.html
    + '<div class="foot">' + (inp.footer ? esc(inp.footerText || '') : '') + '</div></div>';
  return {html: html, pageVars: inp.page || pageVarsOf(pi), cardVars: PAL[pi], leaks: b.leaks};
}

/** The buttons of one group (c, s or w) for the Tabs layout. */
export function renderTab(inp, group) {
  setup(inp);
  return rows(group === 'c' ? CT : group === 's' ? SO : WE);
}

/* Design Pack 2 (faces 401 to 500) is built by scripts/build-pack2.mjs into generated/pack2.js and joins the face list here,
   before the count is taken. A rebuild of the whole library must keep this block: the pack2 build looks for the import and
   leaves the face list alone when it is already there (and the library build runs the engine without it, see
   build-design-library.mjs). Each pack face draws from the same person object P as the faces above. */
/* pack2 start */
import PACK2 from "./pack2.js";
PACK2.forEach(function (f) { D.push({n: f.n, tags: f.tags, p: f.p, h: function () { return f.h(P); }}); });
/* pack2 end */

export var FACE_COUNT = D.length, BELOW_COUNT = DV.length, INTRO_COUNT = OPS.length;
