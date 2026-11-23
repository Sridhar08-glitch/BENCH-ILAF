/* State and helpers shared by every face, layout and opening. The design page kept one sample person in
   these variables; here they are filled from the real card for each render (see engine-tail.js). */
var P = {};
var PH = '', EM = '', WB = '', AD = '';
var QRSVG = '', PHOTO = '', MODE = 'live';
var IMG = {c: ['', '', '']};
var GHOST = '';
/* The lists are refilled in place because the layout files keep a reference to ITEMS. */
var ITEMS = [], LIVE = [], CT = [], SO = [], WE = [];

/*@@IC@@*/
/*@@ESC@@*/

function pic() {
  return PHOTO ? '<img class="pic" alt="" src="' + PHOTO + '">' : '<span class="pic">' + P.ini + '</span>';
}
/* the logo of a button, drawn by the app */
function IH(i) {
  return i.ih || '';
}
/* attributes that make an element a real link (or an inert one in thumbnails) */
function LA(i) {
  if (i.z) return ' data-z="1"';
  var a = ' data-i="' + i.x + '"';
  if (MODE === 'thumb') return a;
  if (!i.h) return a + ' aria-disabled="true"';
  return a + ' href="' + i.h + '"' + (i.nt ? ' target="_blank" rel="noopener noreferrer"' : '');
}
/* the buttons in the given slots that exist */
function LV(ks) {
  return ks.map(function (k) { return ITEMS[k]; }).filter(function (i) { return i && !i.z; });
}
