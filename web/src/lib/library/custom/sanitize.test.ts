import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import corpus from "./sanitize-corpus.json";
import {
  CONDITIONS, MAX_DATA_BYTES, PLACEHOLDERS, PROPS, decodeEntities, escapeText, isClean, sanitizeCss, sanitizeFace, sanitizeTemplate,
} from "./sanitize";

const FACE = 7;
const MEDIA = ["/media/logos/own.png"];
const PREFIX = `.cfl .face.cf-${FACE}`;
const t = (s: string) => sanitizeTemplate(s, MEDIA);
const c = (s: string) => sanitizeCss(s, FACE, MEDIA);

// ---------------------------------------------------------------- the shared corpus (written by backend/tests/test_sanitize.py)
describe("shared corpus with the backend sanitiser", () => {
  it("has the corpus of the backend, unchanged", () => {
    const file = path.resolve(__dirname, "../../../../../backend/tests/sanitize_corpus.json");
    if (!fs.existsSync(file)) return; // the web app is built on its own
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual(corpus);
  });

  it("reads face and media like the backend", () => {
    expect(corpus.face).toBe(FACE);
    expect(corpus.media).toEqual(MEDIA);
    expect(corpus.templates.length).toBeGreaterThanOrEqual(120);
    expect(corpus.styles.length).toBeGreaterThanOrEqual(120);
  });

  it("cleans every template exactly as the backend does", () => {
    const bad: string[] = [];
    corpus.templates.forEach((row, i) => {
      const got = t(row.in).value;
      if (got !== row.out) bad.push(`#${i} ${JSON.stringify(row.in.slice(0, 80))} -> ${JSON.stringify(got.slice(0, 80))} (backend ${JSON.stringify(row.out.slice(0, 80))})`);
    });
    expect(bad).toEqual([]);
  });

  it("cleans every style sheet exactly as the backend does", () => {
    const bad: string[] = [];
    corpus.styles.forEach((row, i) => {
      const got = c(row.in).value;
      if (got !== row.out) bad.push(`#${i} ${JSON.stringify(row.in.slice(0, 80))} -> ${JSON.stringify(got.slice(0, 100))} (backend ${JSON.stringify(row.out.slice(0, 100))})`);
    });
    expect(bad).toEqual([]);
  });
});

// ---------------------------------------------------------------- an independent look at the output
const ALLOWED_TAGS = new Set(["div", "span", "p", "i", "b", "small", "br", "img", "svg", "g", "defs", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "lineargradient", "radialgradient", "stop", "clippath", "mask"]);
const ALLOWED_ATTRS = new Set(["class", "src", "alt", "width", "height", "viewbox", "preserveaspectratio", "d", "points", "transform", "gradienttransform", "stroke-dasharray", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "fx", "fy", "stroke-width", "stroke-miterlimit", "offset", "fill", "stroke", "stop-color", "opacity", "fill-opacity", "stroke-opacity", "stop-opacity", "clip-path", "mask", "id", "stroke-linecap", "stroke-linejoin", "fill-rule", "clip-rule", "gradientunits", "spreadmethod", "clippathunits", "maskunits"]);
const VOID = new Set(["br", "img", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "stop"]);

function safeTemplate(out: string) {
  const stack: string[] = [];
  const re = /<(\/?)([A-Za-z][A-Za-z0-9]*)((?:\s+[A-Za-z-]+="[^"<>]*")*)\s*(\/?)>/g;
  let rest = out;
  let m: RegExpExecArray | null;
  const tags: string[] = [];
  while ((m = re.exec(out))) {
    tags.push(m[0]);
    const name = m[2].toLowerCase();
    expect(ALLOWED_TAGS.has(name), `tag ${name} in ${out.slice(0, 120)}`).toBe(true);
    for (const a of m[3].matchAll(/\s+([A-Za-z-]+)="([^"]*)"/g)) {
      expect(ALLOWED_ATTRS.has(a[1].toLowerCase()), `attr ${a[1]}`).toBe(true);
      if (a[1] === "src") expect(a[2].startsWith("data:image/") || MEDIA.includes(a[2])).toBe(true);
      else expect(a[2].toLowerCase()).not.toMatch(/javascript|expression|vbscript|data:/);
    }
    if (m[1]) {
      expect(stack.pop(), `unbalanced ${m[0]} in ${out.slice(0, 120)}`).toBe(name);
    } else if (!VOID.has(name) && !m[4]) stack.push(name);
    rest = rest.replace(m[0], "");
  }
  expect(stack, "unclosed").toEqual([]);
  expect(rest, `stray angle bracket in ${out.slice(0, 120)}`).not.toMatch(/[<>]/);
  expect(tags.join(" ").toLowerCase()).not.toMatch(/<script|<style|<iframe|<object|<embed|foreignobject|<use|style=|href=|xlink|<a /);
  let depth = 0;
  for (const p of out.matchAll(/\{\{(#if [a-z_]+|\/if|else|[a-z_]+)\}\}/g)) {
    if (p[1].startsWith("#if")) {
      expect(CONDITIONS.includes(p[1].slice(4))).toBe(true);
      depth++;
    } else if (p[1] === "/if") depth--;
    else if (p[1] !== "else") expect(PLACEHOLDERS.includes(p[1])).toBe(true);
    expect(depth).toBeGreaterThanOrEqual(0);
  }
  expect(depth).toBe(0);
}

function safeCss(out: string) {
  const low = out.toLowerCase();
  for (const bad of ["@import", "@charset", "@font-face", "expression", "behavior", "-moz-binding", "javascript", "vbscript", "<", "\\", "/*", "*/", "position:fixed", "position:sticky", "!important", "@media", "@supports"]) {
    expect(low, bad).not.toContain(bad);
  }
  const plain = out.replace(/url\("[^"]*"\)/g, "");
  expect(plain).not.toMatch(/\d(vw|vh|vmin|vmax|px|rem|pt)\b/);
  expect(plain).not.toContain("url(");
  for (const m of out.matchAll(/url\("([^"]*)"\)/g)) expect(m[1].startsWith("data:image/") || MEDIA.includes(m[1])).toBe(true);
  let depth = 0;
  for (const ch of out.replace(/"[^"]*"/g, '""')) {
    depth += ch === "{" ? 1 : ch === "}" ? -1 : 0;
    expect(depth).toBeGreaterThanOrEqual(0);
  }
  expect(depth).toBe(0);
  for (const rule of out.matchAll(/(?:^|\})\s*([^{}@]+)\{/g)) {
    for (const sel of rule[1].split(",")) {
      const s = sel.trim();
      if (s && !/^(\d+(\.\d+)?%|from|to)$/.test(s)) expect(s.startsWith(PREFIX), `unscoped ${s}`).toBe(true);
    }
  }
  for (const n of out.matchAll(/@keyframes ([^{]+)\{/g)) expect(n[1].startsWith(`cf${FACE}-`)).toBe(true);
  for (const block of out.matchAll(/\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)) {
    for (const p of block[1].replace(/"[^"]*"/g, '""').matchAll(/(?:^|[;{}])\s*([a-z-]+):/g)) expect(PROPS[p[1]], p[1]).toBeDefined();
  }
}

// ---------------------------------------------------------------- hostile inputs
const HOSTILE_TEMPLATES = [
  "<script>alert(1)</script>", "<SCRIPT SRC=//evil/x.js></SCRIPT>", "<scr<script>ipt>alert(1)</scr</script>ipt>", "<script>alert(1)",
  "<img src=x onerror=alert(1)>", '<img src="javascript:alert(1)">', '<img src="java&#115;cript:alert(1)">', '<img src="&#x6A;avascript:alert(1)">',
  '<img src="jav&#x09;ascript:alert(1)">', '<img src="javascript&colon;alert(1)">', "<img src=`x` onerror=alert(1)>",
  '<img src="data:text/html;base64,PHNjcmlwdD4=">', '<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">', '<img src="https://evil.example/p.gif">',
  "<svg onload=alert(1)></svg>", "<svg><script>alert(1)</script></svg>", "<svg><foreignObject><iframe src=x></iframe></foreignObject></svg>",
  '<svg><use href="data:image/svg+xml;base64,AAAA#x"/></svg>', '<svg><animate attributeName="href" values="javascript:alert(1)"/></svg>',
  '<svg><image href="//evil/x.png"/></svg>', '<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>', '<svg><path d="M0 0" onclick="alert(1)"/></svg>',
  '<svg><rect fill="url(javascript:alert(1))"/></svg>', '<svg><rect clip-path="url(http://evil/x#c)" width="1" height="1"/></svg>',
  '<div style="background:url(javascript:alert(1))">x</div>', '<a href="javascript:alert(1)">x</a>', "<iframe srcdoc='<script>alert(1)</script>'></iframe>",
  '<object data="javascript:alert(1)"></object>', '<link rel=stylesheet href="//evil/x.css">', '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
  '<form action="javascript:alert(1)"><input name=x></form>', "<input onfocus=alert(1) autofocus>", "<style>@import url(//evil/x.css);</style>",
  "<!-- <script>alert(1)</script> -->", "<![CDATA[<script>alert(1)</script>]]>", "<textarea><script>alert(1)</script></textarea>",
  '<noscript><p title="</noscript><img src=x onerror=alert(1)>">', "<plaintext><script>alert(1)", "<template><script>alert(1)</script></template>",
  '<div class="a onclick=alert(1)', "<div class=a", '<div class="a" class="b" onclick="x">z</div>', '<div ONCLICK="alert(1)" OnMouseOver=alert(2)>z</div>',
  "<div/onclick=alert(1)>z</div>", "&lt;script&gt;alert(1)&lt;/script&gt;", "&#60;script&#62;alert(1)", "AT&T &amp; &unknown; &#0; &#xD800; &#1114112;",
  "a < b > c <3 <= <", "<scr\u0000ipt>alert(1)</scr\u0000ipt>", "<section><h1>Title</h1><a>link</a></section>", '<div class="card face back colg cohead x">y</div>',
  "<div>".repeat(200) + "x" + "</div>".repeat(200), "</div></span><div><b></div></b>", "<p><div>x</div></p>", '<div class="{{name}}" title="{{phone}}">{{name}}</div>',
  "{{bogus}} {{ constructor }} {{__proto__}} {{name.toString()}} {{{name}}}", "{{#if photo}}<div>x{{/if}}</div>{{/if}}{{else}}", "{{#if bogus}}x{{/if}}{{#if}}y{{/if}}",
  "<div>{{#if phone}}<b>{{phone}}</div></b>{{/if}}", "{{#if photo}}a{{else}}b{{else}}c{{/if}}", "{{#if photo}}<script>alert(1)</script>{{/if}}",
  "<div>" + "{{name}}".repeat(2000) + "</div>", '<img alt="x" onerror="y">', "<br><br/><br >", "<constructor><__proto__>x</__proto__></constructor>",
  '<div class="__proto__ constructor toString">x</div>', '<svg viewBox="0 0 1 1 onload=alert(1)"></svg>', '<svg style="x:y"><path d="M0 0"/></svg>',
];

const HOSTILE_CSS = [
  "@import url(//evil/x.css); .a{color:red}", "@import 'x.css';", ".a{background:url(javascript:alert(1))}", '.a{background:url( "javascript:alert(1)" )}',
  ".a{background:url(data:text/html,<script>alert(1)</script>)}", ".a{background:url(http://evil.example/x.png)}", ".a{background:url(//evil.example/x.png)}",
  ".a{background:url(/media/logos/theirs.png)}", ".a{background:\\75 rl(javascript:alert(1))}", ".a{background:ur\\6c(javascript:alert(1))}",
  ".a{background:ur/**/l(javascript:alert(1))}", ".a{background:url(javascript:alert(1)", ".a{width:expression(alert(1))}", ".a{width:\\65 xpression(alert(1))}",
  ".a{-moz-binding:url(//evil/x.xml#x)}", ".a{behavior:url(x.htc)}", ".a{color:red}} body{display:none}", ".a{color:red;} } .b{display:none} .c{",
  '.a{content:"}"} body{display:none}', ".a{color:red}</style><script>alert(1)</script>.b{color:blue}", '.a{content:"</style><script>alert(1)</script>"}',
  "<!-- .a{color:red} --> .b{color:blue}", "/*/* */ .a{color:red} */ body{display:none}", ".a{co/**/lor:red}", ".a{color:red} /* .b{display:none}",
  ".a{\\70 osition:fixed}", ".a{position:\\66 ixed}", ".a{color:red}\\", ".a{position:fixed;top:0}", ".a{position:sticky}", '@font-face{font-family:"X";src:url(//evil/x.woff2)}',
  '@charset "x"; .a{color:red}', "@media (min-width:1px){.a{color:red}}", "@supports (display:grid){.a{color:red}}", "@keyframes evil{from{opacity:0}to{opacity:1}}",
  `@keyframes cf${FACE}-x{0%{opacity:0}100%{opacity:1}} .a{animation:cf${FACE}-x 1s infinite}`, `.a{animation:cf${FACE}-x 30s}`, `.a{animation:cf${FACE}-x 2s 4}`,
  ".a{animation:cf99-x 1s}", ".a{animation-iteration-count:infinite}", ".a{width:100vw}", ".a{height:100vh}", ".a{top:-100vmin}", ".a{width:10px}", ".a{font-size:2rem}",
  ".a{width:calc(100vw - 2cqw)}", ".a{transform:translate(100vw,0)}", ".a::before{content:url(http://evil/x.png)}", ".a::before{content:attr(href)}",
  ".a{filter:url(#x)}", ".a{filter:blur(500cqw)}", ".a{mask:url(x.svg)}", ".a{background:image-set(url(x.png) 1x)}", ".a{--x:url(javascript:alert(1));color:var(--x)}",
  ".a{color:var(--secret, red)}", "body{display:none}", "html,:root{display:none}", "*{display:none}", "#id{color:red}", "[onclick]{color:red} a[href^=javascript]{color:red}",
  "a:hover{color:red}", ".a,body,.b{color:red}", ".\\62 ody{color:red}", ".a::first-line{color:red}", ":scope{color:red} :scope .a{color:blue}", ".a:not(body){color:red}",
  ".a:nth-child(javascript){color:red}", ".a{color:red; .b{color:blue}}", ".a{@media screen{color:blue}}", ".a{zoom:5;cursor:url(x),auto;resize:both}",
  ".a{color:red !important}", '.a{content:"abc}', ".a{content:'abc\n;color:red}", ".a{ba\u0000ckground:ur\u0000l(x)}", "﻿.a{color:red}", "", "/* x */", "}}}{{{;;;:::)))(((",
  '.a{font-family:"Evil Font",system-ui}', ".a{z-index:9999}", ".a{opacity:50}", ".a{width:1e999cqw}", ".a{width:-1e999cqw}", ".constructor{color:red} .__proto__{color:red}",
  "constructor{color:red}", ".a{constructor:red;__proto__:red;toString:red}", ".a{color:constructor}", ".a{display:__proto__}",
];

describe("hostile templates", () => {
  it("has at least 60 cases", () => expect(HOSTILE_TEMPLATES.length + HOSTILE_CSS.length).toBeGreaterThanOrEqual(120));
  for (const [i, src] of HOSTILE_TEMPLATES.entries()) {
    it(`template #${i} comes out safe and stable`, () => {
      const res = t(src);
      expect(res.errors).toEqual([]);
      safeTemplate(res.value);
      const again = t(res.value);
      expect(again.value).toBe(res.value);
      expect(again.warnings).toEqual([]);
    });
  }
});

describe("hostile style sheets", () => {
  for (const [i, src] of HOSTILE_CSS.entries()) {
    it(`style sheet #${i} comes out safe and stable`, () => {
      const res = c(src);
      safeCss(res.value);
      expect(c(res.value).value).toBe(res.value);
    });
  }
});

describe("what stays and what goes", () => {
  it("templates", () => {
    expect(t("<script>alert(1)</script>").value).toBe("");
    expect(t("<div onclick='x()'>{{name}}</div>").value).toBe("<div>{{name}}</div>");
    expect(t("<section><h1>T</h1></section>").value).toBe("T");
    expect(t("&lt;script&gt;").value).toBe("&lt;script&gt;");
    expect(t("a < b").value).toBe("a &lt; b");
    expect(t("{{ name }}").value).toBe("{{name}}");
    expect(t("{{#if photo}}<div>x").value).toBe("{{#if photo}}<div>x</div>{{/if}}");
    expect(t("{{#if photo}}a{{else}}b{{/if}}").value).toBe("{{#if photo}}a{{else}}b{{/if}}");
    expect(t('<div class="card k">y</div>').value).toBe('<div class="k">y</div>');
    expect(t("<br><br/>").value).toBe("<br><br>");
    expect(t('<img src="data:image/png;base64,iVBORw0KGgo=" alt="x" width="10%">').value).toBe('<img src="data:image/png;base64,iVBORw0KGgo=" alt="x" width="10%">');
    expect(t('<img src="/media/logos/own.png">').value).toBe('<img src="/media/logos/own.png">');
    expect(t('<img src="/media/logos/theirs.png">').value).toBe("");
  });

  it("style sheets", () => {
    expect(c(".a{color:red}").value).toBe(`${PREFIX} .a{color:red}`);
    expect(c(".a{color:red}} body{display:none}").value).toBe(`${PREFIX} .a{color:red}`);
    expect(c(".a{\\63 olor:red}").value).toBe(`${PREFIX} .a{color:red}`);
    expect(c(".a{width:100vw;color:red}").value).toBe(`${PREFIX} .a{color:red}`);
    expect(c(":scope{color:red}").value).toBe(`${PREFIX}{color:red}`);
    expect(c(".a>.b+.c{left:0}").value).toBe(`${PREFIX} .a > .b + .c{left:0}`);
    expect(c(".a:first-child::before{content:'x'}").value).toBe(`${PREFIX} .a:first-child::before{content:"x"}`);
    expect(c(".a{width:calc(100% - 8cqw)}").value).toContain("calc(100% - 8cqw)");
    expect(c(`@keyframes cf${FACE}-a{0%{opacity:0}100%{opacity:1}} .x{animation:cf${FACE}-a 2s ease 1 forwards}`).value).toContain(`animation:cf${FACE}-a 2s ease 1 forwards`);
    expect(c(`.x{animation:cf${FACE}-a 6s}`).value).toBe("");
  });

  it("warnings carry a code and the values they mention", () => {
    const res = t('<div class="card" onclick="x" style="color:red">{{nope}}<script>1</script></div>');
    expect(new Set(res.warnings.map((w) => w.code))).toEqual(new Set(["reserved_class", "event_attr", "style_attr", "placeholder", "dropped_element"]));
    expect(res.warnings.find((w) => w.code === "dropped_element")?.params).toEqual({ tag: "script" });
    expect(res.warnings.find((w) => w.code === "event_attr")?.params).toEqual({ name: "onclick" });
    const css = c("@import 'x'; body{x:y} .a{width:100vw;zoom:2;color:red !important}");
    expect(new Set(css.warnings.map((w) => w.code))).toEqual(new Set(["at_rule", "selector", "value", "property", "important"]));
    expect(css.warnings.find((w) => w.code === "property")?.params).toEqual({ name: "zoom" });
  });

  it("limits", () => {
    expect(t("<div></div>".repeat(6000)).errors.map((e) => e.code)).toEqual(["too_large"]);
    expect(t(null as unknown as string).errors.map((e) => e.code)).toEqual(["type"]);
    expect(c(null as unknown as string).errors.map((e) => e.code)).toEqual(["type"]);
    expect(c("a{}".repeat(50000)).errors.map((e) => e.code)).toEqual(["too_large"]);
    const big = c(`.a{background:url(data:image/png;base64,${"A".repeat(150000)})} .b{background:url(data:image/png;base64,${"A".repeat(150000)})}`);
    expect(big.value.split("url(").length - 1).toBe(1);
    expect(big.dataBytes).toBeLessThanOrEqual(MAX_DATA_BYTES);
    expect(t("<div>".repeat(100) + "deep" + "</div>".repeat(100)).value.split("<div>").length - 1).toBeLessThanOrEqual(20);
  });

  it("decodes entities the way a browser would, and escapes text", () => {
    expect(decodeEntities("java&#115;cript&colon;x")).toBe("javascript:x");
    expect(decodeEntities("&#x41;&amp;&unknown;")).toBe("A&&unknown;");
    expect(escapeText("a < b & c &amp; d")).toBe("a &lt; b &amp; c &amp; d");
  });

  it("knows when a stored face is already clean", () => {
    expect(isClean("<div>{{name}}</div>", `${PREFIX} .a{color:red}`, FACE)).toBe(true);
    expect(isClean("<script>x</script>", "", FACE)).toBe(false);
    expect(isClean("<div>x</div>", ".a{color:red}", FACE)).toBe(false);
  });
});

// ---------------------------------------------------------------- property tests
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
const HTML_BITS = ["<div>", "</div>", '<span class="a b">', "</span>", "<p>", "</p>", "<b>", "</b>", "<i>", "<small>", "</small>", "<br>", "<br/>", '<img src="data:image/png;base64,AAAA" alt="x">', "<img src=x onerror=alert(1)>", "<script>", "</script>", "<style>", "</style>", '<svg viewBox="0 0 1 1">', "</svg>", '<path d="M0 0L1 1"/>', '<rect width="1" height="1" fill="#fff"/>', "<g>", "</g>", "<defs>", "</defs>", '<linearGradient id="g">', "</linearGradient>", "<foreignObject>", "</foreignObject>", "{{name}}", "{{photo}}", "{{#if photo}}", "{{#if phone}}", "{{else}}", "{{/if}}", "{{bogus}}", "{{", "}}", "text", " ", "\n", "&amp;", "&lt;", "&", "<", ">", '"', "'", "<!--", "-->", '<a href="javascript:x">', "</a>", '<div onclick="x">', '<div style="a:b">', "=", "/", "\\", "\u0000", "<?", "<![CDATA[", "]]>", "<iframe>", "javascript:", "&#106;avascript:"];
const CSS_BITS = [".a", ".b", "{", "}", ";", ":", ",", " ", "\n", "color:red", "color:#fff", "width:10cqw", "width:100vw", "position:fixed", "position:absolute", "background:url(javascript:x)", "background:url(data:image/png;base64,AAAA)", "background:linear-gradient(#fff,#000)", "@import", "@keyframes", `@keyframes cf${FACE}-k`, "from", "to", "50%", `animation:cf${FACE}-k 1s`, "animation:x infinite", "/*", "*/", "\\", "\\6a ", "url(", ")", "(", '"', "'", "expression(", "!important", "body", "html", ":root", "*", ">", "+", "~", "::before", ":hover", ":first-child", 'content:"x"', "content:url(x)", "<", "</style>", "-->", "<!--", "\u0000", "var(--cacc)", "calc(", "100% - 2cqw", "transform:rotate(3deg)", 'font-family:"Poppins"', "@media", "[a]", "#id"];

describe("property tests", () => {
  it("random templates are always safe and stable", () => {
    const r = rng(20260101);
    for (let i = 0; i < 400; i++) {
      const src = Array.from({ length: 1 + Math.floor(r() * 40) }, () => HTML_BITS[Math.floor(r() * HTML_BITS.length)]).join("");
      const res = t(src);
      expect(res.errors).toEqual([]);
      safeTemplate(res.value);
      expect(t(res.value).value, src).toBe(res.value);
    }
  });

  it("random style sheets are always safe and stable", () => {
    const r = rng(20260102);
    for (let i = 0; i < 400; i++) {
      const src = Array.from({ length: 1 + Math.floor(r() * 50) }, () => CSS_BITS[Math.floor(r() * CSS_BITS.length)]).join("");
      const res = c(src);
      safeCss(res.value);
      expect(c(res.value).value, src).toBe(res.value);
    }
  });

  it("random characters never throw", () => {
    const r = rng(7);
    for (let i = 0; i < 150; i++) {
      const src = Array.from({ length: Math.floor(r() * 200) }, () => String.fromCharCode(r() < 0.5 ? Math.floor(r() * 128) : Math.floor(r() * 0x2ff))).join("");
      safeTemplate(t(src).value);
      safeCss(c(src).value);
    }
  });

  it("text keeps its order", () => {
    const r = rng(3);
    const w = ["alpha", "beta", "gamma", "ünï", "مرحبا", "x1"];
    for (let i = 0; i < 80; i++) {
      const picked = Array.from({ length: 1 + Math.floor(r() * 8) }, () => w[Math.floor(r() * w.length)]);
      const src = picked.map((x) => (r() < 0.5 ? `<div class="c">${x}</div>` : `<span>${x}</span>`)).join("");
      expect(t(src).value.replace(/<[^>]+>/g, "")).toBe(picked.join(""));
    }
  });

  it("clean faces are unchanged when cleaned again", () => {
    const res = sanitizeFace("<div class=\"n\">{{name}}</div>", ".n{font-size:5cqw}", 12);
    expect(res.errors).toEqual([]);
    expect(isClean(res.template, res.css, 12)).toBe(true);
    expect(PROPS["font-size"]).toBeDefined();
  });
});
