import { describe, expect, it } from "vitest";
import {
  DEFAULT_COLOURS, TEMPLATES, buildSignatureHtml, buildSignatureText, emailHtmlProblems, esc, imageSrc, signatureLabels, type SignatureData, type SignatureOptions, type SignatureTemplate,
} from "./signature";
import { createI18n } from "@/lib/i18n";
import { en } from "@/lib/i18n/messages";

const english = createI18n("en", "latn", en);
const arabic = createI18n("ar", "latn", { "tools.sigViewCard": "عرض بطاقتي", "tools.sigMyCard": "بطاقتي", "tools.sigPhotoAlt": "صورة", "tools.sigLogoAlt": "الشعار", "tools.sigQrAlt": "رمز QR لـ{name}", "tools.sigMyCardName": "بطاقتي" });
const labels = signatureLabels(english.t);

const data: SignatureData = {
  name: "Sara Al Thani", title: "Head of Sales", company: "Gulf Studio & Co", phone: "+974 5555 1234", email: "sara@gulfstudio.example",
  website: "https://www.gulfstudio.example/", address: "West Bay\nDoha, Qatar",
  photoUrl: "https://cdn.example.com/media/cards/sara.jpg", logoUrl: "https://cdn.example.com/media/logos/gulf.png",
  qrUrl: "https://api.example.com/api/v1/public/cards/abc123defg/qr.png?size=300", cardUrl: "https://bench.example.com/c/sara",
  buttons: [{ label: "Book a meeting", href: "https://calendly.com/sara" }, { label: "Bad", href: "javascript:alert(1)" }],
};
const opts = (template: SignatureTemplate, over: Partial<SignatureOptions> = {}): SignatureOptions => ({
  template, showPhoto: true, showQr: true, showButtons: true, colours: DEFAULT_COLOURS, labels, ...over,
});

describe("signature html follows the mail-client rules", () => {
  for (const { key } of TEMPLATES) {
    it(`${key}: no style block, classes, scripts, url() or relative pictures, in every option combination`, () => {
      for (const showPhoto of [true, false]) for (const showQr of [true, false]) for (const showButtons of [true, false]) {
        const html = buildSignatureHtml(data, opts(key, { showPhoto, showQr, showButtons }));
        expect(emailHtmlProblems(html), `${key} ${showPhoto} ${showQr} ${showButtons}`).toEqual([]);
      }
    });
  }

  it("uses absolute https pictures for photo, logo and QR", () => {
    const classic = buildSignatureHtml(data, opts("classic"));
    expect(classic).toContain('src="https://cdn.example.com/media/cards/sara.jpg"');
    expect(classic).toContain('src="https://api.example.com/api/v1/public/cards/abc123defg/qr.png?size=300"');
    expect(classic).toMatch(/<img [^>]*width="80" height="80"/);
    const banner = buildSignatureHtml(data, opts("banner"));
    expect(banner).toContain('src="https://cdn.example.com/media/logos/gulf.png"');
  });

  it("drops what is switched off", () => {
    const html = buildSignatureHtml(data, opts("classic", { showPhoto: false, showQr: false, showButtons: false }));
    expect(html).not.toContain("<img");
    expect(html).not.toContain("View my card");
  });

  it("leaves a picture out when it has no usable address", () => {
    const html = buildSignatureHtml({ ...data, photoUrl: "/media/x.jpg", qrUrl: null }, opts("classic"));
    expect(html).not.toContain("<img");
  });

  it("escapes text and refuses unsafe links", () => {
    const html = buildSignatureHtml({ ...data, name: '<img src=x onerror=alert(1)>"' }, opts("classic"));
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;&quot;");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain(">Bad<");
  });

  it("links the phone, e-mail and website, and the card", () => {
    const html = buildSignatureHtml(data, opts("compact"));
    expect(html).toContain('href="tel:+97455551234"');
    expect(html).toContain('href="mailto:sara@gulfstudio.example"');
    expect(html).toContain('href="https://www.gulfstudio.example/"');
    expect(html).toContain("Gulf Studio &amp; Co");
    expect(html).toContain('href="https://bench.example.com/c/sara"');
  });

  it("uses the chosen colours", () => {
    const html = buildSignatureHtml(data, opts("banner", { colours: { bg: "#0F2D5C", bg2: "#2B456F", fg: "#F8F9FA", acc: "#D2A63B", on: "#0F2D5C" } }));
    expect(html).toContain('bgcolor="#0F2D5C"');
    expect(html).toContain("#D2A63B");
  });

  it("falls back to the company name when there is no logo", () => {
    const html = buildSignatureHtml({ ...data, logoUrl: null }, opts("banner", { showPhoto: false, showQr: false }));
    expect(html).toContain("Gulf Studio &amp; Co");
    expect(html).not.toContain("<img");
  });

  it("copes with a card that has almost nothing on it", () => {
    const empty: SignatureData = { name: "Sam", title: "", company: "", phone: "", email: "", website: "", address: "", photoUrl: null, logoUrl: null, qrUrl: null, cardUrl: "https://bench.example.com/c/sam", buttons: [] };
    for (const { key } of TEMPLATES) {
      const html = buildSignatureHtml(empty, opts(key));
      expect(html).toContain("Sam");
      expect(emailHtmlProblems(html)).toEqual([]);
    }
  });
});

describe("the checker itself", () => {
  it("catches what mail clients break on", () => {
    const bad = '<div class="a"><style>.a{}</style><img src="/x.png"><table><tr><td style="background:url(x.png)">hi</td></tr></table><script>1</script></div>';
    const found = emailHtmlProblems(bad);
    for (const code of ["styleBlock", "cssClass", "cssUrl", "relativePicture", "pictureSize", "pictureAlt", "script", "tableAttrs"] as const) expect(found).toContain(code);
  });
});

describe("right to left signature", () => {
  const rtlLabels = signatureLabels(arabic.t);
  const rtl = (template: SignatureTemplate) => buildSignatureHtml(data, opts(template, { rtl: true, labels: rtlLabels }));

  for (const { key } of TEMPLATES) {
    it(`${key}: every table is right to left, text is aligned right, and it still follows the mail rules`, () => {
      const html = rtl(key);
      for (const m of html.matchAll(/<table\b[^>]*>/gi)) expect(m[0]).toContain('dir="rtl"');
      expect(html).toContain("text-align:right");
      expect(html).toContain("Tahoma");
      expect(html).not.toContain("text-align:left");
      expect(emailHtmlProblems(html)).toEqual([]);
    });
  }

  it("uses the Arabic words and keeps phone, e-mail and links left to right", () => {
    const html = rtl("classic");
    expect(html).toContain("عرض بطاقتي");
    expect(html).toMatch(/alt="رمز QR لـ.{0,2}Sara Al Thani/);
    expect(html).toContain('<span dir="ltr"');
    expect(buildSignatureText(data, { showButtons: true, labels: rtlLabels, rtl: true })).toContain("بطاقتي: https://bench.example.com/c/sara");
  });

  it("puts the borders and paddings on the right in compact and the photo gap on the left in classic", () => {
    expect(rtl("compact")).toContain("border-right:3px solid");
    expect(rtl("classic")).toContain("padding-left:16px");
  });

  it("stays left to right for Latin", () => {
    const html = buildSignatureHtml(data, opts("compact"));
    expect(html).not.toContain('dir="rtl"');
    expect(html).toContain("border-left:3px solid");
  });
});

describe("plain text version and helpers", () => {
  it("lists name, role, contact line, address and card link", () => {
    expect(buildSignatureText(data, { showButtons: true, labels })).toBe(
      "Sara Al Thani\nHead of Sales, Gulf Studio & Co\n+974 5555 1234 | sara@gulfstudio.example | www.gulfstudio.example\nWest Bay, Doha, Qatar\nMy card: https://bench.example.com/c/sara",
    );
    expect(buildSignatureText(data, { showButtons: false, labels })).not.toContain("My card");
  });
  it("accepts http(s) picture addresses only", () => {
    expect(imageSrc("https://a.b/c.png")).toBe("https://a.b/c.png");
    expect(imageSrc("data:image/png;base64,AAAA")).toBeNull();
    expect(imageSrc("/media/a.png")).toBeNull();
    expect(imageSrc('https://a.b/"onerror=1')).toBeNull();
    expect(imageSrc(null)).toBeNull();
  });
  it("escapes the five characters", () => {
    expect(esc(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });
});
