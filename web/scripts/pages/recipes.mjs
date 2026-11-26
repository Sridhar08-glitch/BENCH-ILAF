// How each designer page (scripts/pages/pages_*.html) becomes a TOP header and a BELOW layout of the engine.
// scripts/build-pages.mjs reads this list. Class names are the designers' own (before the pg- prefix).
//
// Fields of a recipe:
//   no        the page number in the designer files
//   top       the number of the TOP header (1..27); its below layout is 400 + top
//   style     the app pattern the page follows (the chips of the Top step)
//   split     class of the first top-level child that belongs to the BOTTOM (default: the first child that holds the Save button)
//   avatar    class of the element whose drawn silhouette becomes the card photo (or the initials)
//   cover     class of the element that shows the card's cover picture when it has one
//   coverArt  classes (or the tag "svg") of children of the cover that are drawn art and are left out when a cover picture is shown
//   blinq     class of the card block that gives way to the chosen face card (Blinq-style tops)
//   keepTop   keep the designer's top bar (dropped by default: it is app chrome)
//   drop      classes of elements that are removed (sample chrome such as badges, pronouns, team chips)
//   sub       [from, to] text replacements made on the page markup before anything else
//   cond      class -> field: the element is only drawn when that field of the person has a value
//   lists     the groups of buttons, in markup order: { c, role, items, tint, text, template }
//               c        class of the container whose children repeat (or of the repeated siblings themselves)
//               role     "tiles" (icon, label and value), "icons" (icon, maybe a short name)
//               items    all | contact | social | web | nonContact | quick | nonQuick | rest (default rest)
//               tint     bg | fg | none: how a button's own colour is applied to its icon (default: from the markup)
//               text     "value" draws the value instead of the label when the template has one text slot
//               template class of the repeated child inside the container (when the container holds other things too)
export const PLACEHOLDER_FIELDS = { name: "name", first: "first", last: "last", ini: "ini", mono: "mono", title: "title", co: "company", phone: "phone", email: "email", site: "web", city: "addr", bio: "bio" };

/** The designers' Arabic sample person (pages 33 and 34), in the order the longer texts must be replaced. */
export const ARABIC_SAMPLE = [
  ["نورة الكواري", "{name}"], ["مستشارة أعمال", "{title}"], ["مجموعة الخليج", "{co}"], ["الدوحة، قطر", "{city}"],
  ["أساعد الشركات العائلية في الخليج على بناء شراكات طويلة الأمد وخطط نمو واضحة.", "{bio}"], ["أساعد الشركات العائلية في الخليج على بناء شراكات طويلة الأمد", "{bio}"],
  ["+974 5555 0123", "{phone}"], ["noura@gulf-group.qa", "{email}"], ["gulf-group.qa", "{site}"], [">ن<", ">{ini}<"],
];

export const RECIPES = [
  { no: 1, top: 1, style: "Popl", avatar: "av", cover: "cov", coverArt: ["sun", "bok", "svg"],
    lists: [{ c: "soc", role: "icons", items: "social", tint: "bg" }, { c: "tiles", role: "tiles" }] },
  { no: 2, top: 2, style: "Popl", avatar: "av", cover: "hd", coverArt: ["svg"],
    lists: [{ c: "rr", role: "icons", items: "quick", tint: "none" }, { c: "tiles", role: "tiles", items: "nonQuick", tint: "bg" }] },
  { no: 3, top: 3, style: "Popl", avatar: "av", drop: ["live"],
    lists: [{ c: "soc", role: "icons", items: "social", tint: "bg" }, { c: "tiles", role: "tiles" }] },
  { no: 6, top: 4, style: "Blinq", avatar: "av", blinq: "card", drop: ["logo", "bar"],
    lists: [{ c: "rows", role: "tiles", items: "contact" }, { c: "soc", role: "icons", items: "nonContact", tint: "fg" }] },
  { no: 7, top: 5, style: "Blinq", avatar: "av", blinq: "card", drop: ["bar"], sub: [["<span>CARD 03 · WORK</span>", ""]],
    lists: [{ c: "rows", role: "tiles", items: "all" }] },
  { no: 8, top: 6, style: "Blinq", avatar: "av", blinq: "card", cover: "card", coverArt: ["svg"], drop: ["logo", "bar"],
    lists: [{ c: "rows", role: "tiles", items: "contact" }, { c: "soc", role: "icons", items: "nonContact", tint: "bg" }] },
  { no: 9, top: 7, style: "Blinq", avatar: "av", blinq: "card", drop: ["bar"], cond: { bio: "bio" },
    lists: [{ c: "card", template: "rw", role: "tiles", items: "contact" }, { c: "links", role: "icons", items: "nonContact", tint: "none" }] },
  { no: 10, top: 8, style: "Blinq", avatar: "av", blinq: "card", drop: ["top", "chips", "vf", "note"],
    sub: [["<small>Official company card</small>", ""], ['<div class="hex">A</div>', '<div class="hex">{mono}</div>'], ["Corporate Office · {city}", "{city}"], [" · Managed by {co}", ""]],
    lists: [{ c: "rows", role: "tiles", items: "all" }] },
  { no: 11, top: 9, style: "HiHello", avatar: "av", drop: ["bdg", "pr"], sub: [["Design Department · {co}", "{co}"], ["<small>Notes</small>", ""]], cond: { note: "bio" },
    lists: [{ c: "soc", role: "icons", items: "social", tint: "bg" }, { c: "links", role: "tiles" }] },
  { no: 12, top: 10, style: "HiHello", avatar: "av", drop: ["bdg", "pr"], sub: [[/<div class="crumb"><b>\{co\}<\/b>[\s\S]*?<\/div>/, '<div class="crumb"><b>{co}</b></div>']],
    lists: [{ c: "grid", role: "tiles", tint: "bg" }, { c: "rows", role: "tiles", items: "contact", text: "value" }] },
  { no: 13, top: 11, style: "HiHello", avatar: "av", drop: ["bdg", "pr", "cal"], sub: [["Design · {co}", "{co}"], ["<b>About</b>", ""]], cond: { bio: "bio" },
    lists: [{ c: "rr", role: "icons", items: "quick", tint: "none" }, { c: "links", role: "tiles", items: "nonQuick", tint: "bg" }] },
  { no: 14, top: 12, style: "HiHello", cover: "img", coverArt: ["sil", "grain"], drop: ["pr", "bdg"], sub: [["Design Department · {city}", "{city}"]], cond: { bio: "bio" },
    lists: [{ c: "soc", role: "icons", items: "social", tint: "bg" }, { c: "links", role: "tiles" }] },
  { no: 15, top: 13, style: "HiHello", avatar: "ph", drop: ["ribbon", "badge", "chip"], sub: [["Design team · {city}", "{city}"], ["<b>Notes</b>", ""]], cond: { note: "bio" },
    lists: [{ c: "soc", role: "icons", items: "social", tint: "none" }, { c: "lk", role: "tiles" }] },
  { no: 16, top: 14, style: "Wave", avatar: "ava", cover: "cover", coverArt: ["svg"], drop: ["h", "tile"], sub: [["<small>MEMBER</small>", ""]],
    lists: [{ c: "grid", role: "icons", items: "all", tint: "none" }] },
  { no: 17, top: 15, style: "Wave", avatar: "ava", split: "h", drop: ["btns", "h"], sub: [["ATTENDEE · {city}", "{city}"]],
    lists: [{ c: "grid", role: "icons", items: "social", tint: "none" }, { c: "tile", role: "tiles" }] },
  { no: 18, top: 16, style: "Wave", avatar: "ava", cover: "sea", coverArt: ["sun", "svg"], drop: ["h", "tide"],
    lists: [{ c: "grid", role: "icons", items: "all", tint: "none" }] },
  { no: 21, top: 17, style: "Mobilo", avatar: "ph", cover: "cover", coverArt: ["svg"], drop: ["bd", "cap", "h", "chips", "map", "logo"],
    sub: [["Head office · {site}", "{site}"], ["Tower 3, Level 14, West Bay<br>{city}", "{city}"]], cond: { about: "bio", cof: "company" },
    lists: [{ c: "rows", role: "tiles", items: "contact" }] },
  { no: 22, top: 18, style: "Mobilo", avatar: "ava", drop: ["seal", "rail", "h", "cof", "tags"], sub: [["REF · QA-DOH-0421", ""]],
    lists: [{ c: "dos", template: "f", role: "tiles", items: "all" }] },
  { no: 23, top: 19, style: "Mobilo", avatar: "ava", cover: "cover", drop: ["clip"], lists: [] },
  { no: 25, top: 20, style: "Linq", cover: "photo", coverArt: ["svg"], split: "sheet", drop: ["vc", "hint"],
    lists: [{ c: "round", role: "icons", items: "quick", tint: "none" }, { c: "tile", role: "tiles", items: "nonQuick" }] },
  { no: 28, top: 21, style: "Linq", split: "lk", drop: ["top"], sub: [["SINCE 2019<br>{co}", "{co}"]],
    lists: [{ c: "lk", role: "tiles", items: "all" }] },
  { no: 29, top: 22, style: "Dot", avatar: "av", drop: ["st"],
    lists: [{ c: "rb", role: "icons", items: "quick", tint: "none" }, { c: "lk", role: "tiles", items: "nonQuick", tint: "bg" }] },
  { no: 30, top: 23, style: "Dot", avatar: "av", sub: [["<b>About</b>", ""]], cond: { bio: "bio" },
    lists: [{ c: "rb", role: "icons", items: "quick", tint: "none" }, { c: "grid", role: "tiles", items: "nonQuick", tint: "bg" }] },
  { no: 31, top: 24, style: "Dot", avatar: "av", drop: ["feat", "cnt"], split: "stack",
    lists: [{ c: "stack", template: "pl", role: "tiles", items: "all", tint: "bg" }] },
  { no: 32, top: 25, style: "Dot", avatar: "av", drop: ["h3", "chips", "now"], sub: [[/<p>Say hello[^<]*<\/p>/, ""]], cond: { bub: "bio" },
    lists: [{ c: "rows", role: "tiles", items: "nonQuick", tint: "bg" }, { c: "rb", role: "icons", items: "quick", tint: "none" }] },
  { no: 33, top: 26, style: "Arabic", avatar: "av", cover: "cv", drop: ["en", "ft"],
    lists: [{ c: "soc", role: "icons", items: "social", tint: "bg" }, { c: "lk", role: "tiles" }] },
  { no: 34, top: 27, style: "Arabic", avatar: "av", blinq: "card", drop: ["en", "logo", "two", "ft"], sub: [["<b>نبذة</b>", ""]], cond: { note: "bio" },
    lists: [{ c: "rows", role: "tiles", items: "contact" }, { c: "soc", role: "icons", items: "nonContact", tint: "bg" }] },
];
