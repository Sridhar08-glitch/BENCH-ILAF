/* The first 12 layouts below the card (the original 12), written for real cards: every button is a real link,
   groups that have no buttons are left out, and the sample data of the design page is gone.
   Helpers (mk, rows, sec, LV, LA, IH) and the LIVE / CT / SO / WE lists are defined in engine-head.js. */
function mk(i, cls) {
  return '<span class="mk' + (i.k === 'ig' ? ' ig' : '') + (cls ? ' ' + cls : '') + (i.lt ? ' lt' : '') + '" style="' + i.st + '">' + IH(i) + '</span>';
}
function rows(list) {
  return '<div class="lks">' + list.map(function (i) {
    return '<a class="lk"' + LA(i) + '>' + mk(i) + '<div>' + i.l + '<small>' + i.v + '</small></div></a>';
  }).join('') + '</div>';
}
function sec(t, list, fn) {
  return list.length ? '<div class="sp-s"><div class="sp-h">' + t + '</div>' + list.map(fn).join('') + '</div>' : '';
}
function bareLink(i, inner) {
  return '<a' + LA(i) + ' aria-label="' + i.l + '" style="display:contents">' + inner + '</a>';
}
var DV = [
  {n: 'List', d: 'A plain list of your buttons.', h: function () {
    return rows(LIVE);
  }},
  {n: 'App grid', d: 'Icons laid out like a phone home screen, details in a short block.', h: function () {
    var info = (P.phone ? '<div>' + ic('phone') + P.phone + '</div>' : '') + (P.email ? '<div>' + ic('mail') + P.email + '</div>' : '') + (P.addr ? '<div>' + ic('pin') + P.addr + '</div>' : '');
    return '<div class="ag">' + LIVE.map(function (i) { return '<a class="ap"' + LA(i) + '>' + mk(i, 'big') + '<span>' + i.s + '</span></a>'; }).join('') + '</div>' + (info ? '<div class="info">' + info + '</div>' : '');
  }},
  {n: 'Spec sheet', d: 'Grouped like a data sheet: label on the left, value on the right.', h: function () {
    var r = function (i) { return '<a class="sp-r"' + LA(i) + '><span>' + i.l + '</span><b>' + i.v + ' ' + ic('arrow') + '</b></a>'; };
    return '<div class="spec">' + sec('Contact', CT, r) + sec('Social', SO, r) + sec('Links', WE, r) + '</div>';
  }},
  {n: 'Chips', d: 'Big phone and email lines, then every profile as a small pill.', h: function () {
    var reach = (P.phone ? '<div>' + P.phone + '</div>' : '') + (P.email ? '<div>' + P.email + '</div>' : '');
    var rest = LIVE.filter(function (i) { return i.x !== P.phoneX && i.x !== P.emailX; });
    return (reach ? '<div class="reach">' + reach + '</div>' : '') + '<div class="chp">' + rest.map(function (i) { return '<a class="cp"' + LA(i) + '>' + mk(i, 'o s') + i.l + '</a>'; }).join('') + '</div>';
  }},
  {n: 'Brand buttons', d: 'Full-width buttons in each brand\'s own colour.', h: function () {
    return '<div class="bb">' + LIVE.map(function (i) {
      return '<a class="bbtn' + (i.k === 'ig' ? ' ig' : '') + (i.lt ? ' lt' : '') + '"' + LA(i) + ' style="' + i.st + '"><span class="bi">' + IH(i) + '</span><b>' + i.l + '</b><span class="ar">' + ic('arrow') + '</span></a>';
    }).join('') + '</div>';
  }},
  {n: 'Contacts app', d: 'Grouped like the phone\'s own contacts screen.', h: function () {
    var g = function (list) {
      return list.length ? '<div class="cg">' + list.map(function (i) { return '<a class="cr2"' + LA(i) + '><small>' + i.s.toLowerCase() + '</small><span>' + i.v + '</span></a>'; }).join('') + '</div>' : '';
    };
    return g(CT) + g(WE) + g(SO);
  }},
  {n: 'Timeline', d: 'A vertical line with a dot for each place to reach me.', h: function () {
    return '<div class="tl">' + LIVE.map(function (i) { return '<a class="tn"' + LA(i) + '><i style="background:' + i.dot + '"></i><b>' + i.l + '</b><small>' + i.v + '</small></a>'; }).join('') + '</div>';
  }},
  {n: 'Bento', d: 'One big action tile, then small tiles and a map tile.', h: function () {
    var wide = LIVE.filter(function (i) { return i.k === 'wa'; })[0] || LIVE[0];
    var map = LIVE.filter(function (i) { return i.k === 'map'; })[0];
    var rest = LIVE.filter(function (i) { return i !== wide && i !== map; });
    var big = wide ? '<a class="bwa"' + LA(wide) + (wide.k === 'wa' ? '' : ' style="background:' + wide.dot + ';color:' + wide.ink + '"') + '>' + IH(wide) + '<div><b>' + wide.l + '</b><small>' + wide.v + '</small></div></a>' : '';
    var tiles = rest.map(function (i) { return '<a class="bt"' + LA(i) + '>' + mk(i, 's') + '<b>' + i.l + '</b><small>' + i.v + '</small></a>'; }).join('');
    var tile = map ? '<a class="bmap"' + LA(map) + '><div class="mp"></div>' + ic('pin') + '<div><b>' + map.l + '</b><small>' + map.v + '</small></div></a>' : '';
    return '<div class="bn">' + big + tiles + tile + '</div>';
  }},
  {n: 'Dock', d: 'Phone and email set large, social icons in a floating dock.', h: function () {
    var top = (P.phone ? '<div>' + P.phone + '</div>' : '') + (P.email ? '<div>' + P.email + '</div>' : '');
    var rest = LIVE.filter(function (i) { return i.x !== P.phoneX && i.x !== P.emailX && i.k !== 'map'; });
    return (top ? '<div class="dk-t">' + top + '</div>' : '') + '<div class="dock">' + rest.map(function (i) { return bareLink(i, mk(i, 'big r')); }).join('') + '</div>' + (P.addr ? '<div class="adr">' + ic('pin') + P.addr + '</div>' : '');
  }},
  {n: 'Editorial', d: 'Large type links separated by hairlines, no icons.', h: function () {
    return '<div class="ed">' + LIVE.map(function (i) { return '<a class="er"' + LA(i) + '><div><b>' + i.l + '</b><small>' + i.v + '</small></div>' + ic('arrow') + '</a>'; }).join('') + '</div>';
  }},
  {n: 'Tabs', d: 'Three tabs so a visitor sees one short group at a time.', h: function () {
    var tabs = [['c', 'Contact', CT], ['s', 'Social', SO], ['w', 'More', WE]].filter(function (t) { return t[2].length; });
    if (!tabs.length) return '';
    return '<div class="tabs3" role="tablist">' + tabs.map(function (t, n) { return '<button type="button" data-tab="' + t[0] + '" aria-pressed="' + (n === 0) + '">' + t[1] + '</button>'; }).join('') + '</div><div class="tabc">' + rows(tabs[0][2]) + '</div>';
  }},
  {n: 'Accordion', d: 'Folded groups that open one at a time.', h: function () {
    var a = function (t, list, o) { return list.length ? '<details class="ac"' + (o ? ' open' : '') + '><summary>' + t + '<span>' + list.length + '</span></summary>' + rows(list) + '</details>' : ''; };
    var open = CT.length ? 0 : SO.length ? 1 : 2;
    return '<div class="acc">' + a('Contact', CT, open === 0) + a('Social profiles', SO, open === 1) + a('Book and more', WE, open === 2) + '</div>';
  }}
];
