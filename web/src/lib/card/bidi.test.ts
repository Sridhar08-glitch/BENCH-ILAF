import { describe, expect, it } from "vitest";
import { hasArabic, mostlyArabic, textDirection, wrapArabicRuns } from "./bidi";
import { cardI18n, cardLabels, localiseChrome } from "./labels";
import { localiseWords } from "./chrome-words";
import { itemLabel } from "./catalogue";
import { buildEntries } from "./entries";
import { buildInput, drawPage } from "@/lib/library/render";
import { FACE_COUNT, BELOW_COUNT } from "@/lib/library/generated/engine";
import { normalizeDesign } from "@/lib/library";
import { vcardFields, previewFromCard, parseVcard, buildVcard } from "./vcard";
import { PERSONAS } from "./arabic-personas";
import { initials } from "./design";

describe("text direction", () => {
  it("finds Arabic letters", () => {
    expect(hasArabic("محمد")).toBe(true);
    expect(hasArabic("Mohammed")).toBe(false);
    expect(hasArabic("Café 12")).toBe(false);
    expect(hasArabic("ﻣﺤﻤﺪ")).toBe(true); // presentation forms
  });

  it("follows the first letter like dir=auto", () => {
    expect(textDirection("محمد Al Thani")).toBe("rtl");
    expect(textDirection("Khalid خالد")).toBe("ltr");
    expect(textDirection("123 !!")).toBeNull();
    expect(textDirection("  ")).toBeNull();
  });

  it("knows when Arabic is most of a text", () => {
    expect(mostlyArabic("شركة الكواري Qatar")).toBe(true);
    expect(mostlyArabic("Al Kuwari Trading شركة")).toBe(false);
    expect(mostlyArabic("")).toBe(false);
  });
});

describe("initials of Arabic names", () => {
  it("uses the first and last word without the article and keeps the letters apart", () => {
    expect(initials("محمد بن سالم الكواري")).toBe("م‌ك");
    expect(initials("فاطمة")).toBe("ف");
    expect(initials("Sara Al Thani")).toBe("SA");
  });
});

describe("marking Arabic runs", () => {
  it("leaves a page without Arabic alone", () => {
    const html = '<div class="n">Alice Anderson</div>';
    expect(wrapArabicRuns(html)).toBe(html);
  });

  it("wraps a text that is all Arabic as one block", () => {
    expect(wrapArabicRuns('<div class="n">محمد بن سالم الكواري</div>')).toBe(
      '<div class="n"><span class="ar ar-all" dir="rtl">محمد بن سالم الكواري</span></div>',
    );
  });

  it("wraps only the Arabic part of a mixed text", () => {
    const out = wrapArabicRuns("<div>Khalid خالد Al Thani</div>");
    expect(out).toBe('<div>Khalid <span class="ar" dir="rtl">خالد</span> Al Thani</div>');
  });

  it("keeps Arabic punctuation and digits inside one run", () => {
    const out = wrapArabicRuns("<div>الدوحة، شارع 5 برج</div>");
    expect(out).toContain('<span class="ar ar-all" dir="rtl">الدوحة، شارع 5 برج</span>');
  });

  it("never touches attributes, styles or scripts", () => {
    const html = '<div aria-label="محمد" style="x:y">a</div><style>.a>.b{c:d}</style>';
    expect(wrapArabicRuns(html)).toBe(html);
  });
});

describe("card words in the card's language", () => {
  it("English is the source", () => {
    const l = cardLabels(cardI18n("en"));
    expect(l.save).toBe("Save contact");
    expect(l.hint).toBe("Tap the card to flip it");
    expect(l.footer).toContain("Powered by");
  });

  it("Arabic replaces the fixed engine words", () => {
    const labels = cardLabels(cardI18n("ar"));
    const html = '<div class="hint">Tap the card to flip it</div><button class="sv" data-save>Save contact</button><div class="bk1">Scan to save my contact</div><div aria-label="Flip card"></div>';
    const out = localiseChrome(html, "ar", labels);
    expect(out).not.toContain("Save contact");
    expect(out).not.toContain("Tap the card");
    expect(out).toContain(labels.save + "</button>");
    expect(out).toContain(`aria-label="${labels.flip}"`);
    expect(localiseChrome(html, "en", cardLabels(cardI18n("en")))).toBe(html);
  });

  it("swaps decorative words only where they are a whole text", () => {
    expect(localiseWords("<b>Call</b><i>Call me maybe</i>", "ar")).toBe("<b>اتصال</b><i>Call me maybe</i>");
    expect(localiseWords("<b>Call</b>", "en")).toBe("<b>Call</b>");
  });

  it("default button names follow the language, custom labels never change", () => {
    const t = cardI18n("ar").t;
    expect(itemLabel({ kind: "Mobile", value: "+974" }, t)).toBe("اتصال بالجوال");
    expect(itemLabel({ kind: "Mobile", value: "+974" })).toBe("Call mobile");
    expect(itemLabel({ kind: "Custom", label: "قائمة الطعام", value: "x" }, t)).toBe("قائمة الطعام");
    expect(itemLabel({ kind: "Instagram", value: "x" }, t)).toBe("Instagram");
    const entries = buildEntries([{ kind: "Location", value: "https://maps.google.com/?q=doha" }], "", t);
    expect(entries[0].label).toBe("الاتجاهات");
  });
});

describe("Arabic personas on the designs", () => {
  const base = (p: (typeof PERSONAS)[number], face: number, below: number) => ({
    name: p.name, title: p.title, company: p.company, address: p.address, photoUrl: null,
    items: [
      { kind: "Mobile", value: "+974 5555 1111" }, { kind: "Email", value: "info@example.qa" },
      { kind: "Website", value: "example.qa" }, { kind: "Instagram", value: "instagram.com/example" },
      { kind: "Location", value: "https://maps.google.com/?q=doha" },
    ],
    saveContact: true, design: normalizeDesign({ face, below, colour: 0, intro: 0 }), publicUrl: "https://ilaf.one/c/abc", locale: "ar" as const,
  });

  it("there are ten personas with Arabic, mixed and long names", () => {
    expect(PERSONAS).toHaveLength(10);
    expect(PERSONAS.filter((p) => hasArabic(p.name)).length).toBeGreaterThanOrEqual(8);
    expect(PERSONAS.some((p) => hasArabic(p.name) && /[A-Za-z]/.test(p.name))).toBe(true);
  });

  it("every persona draws on forty faces and twenty layouts without losing the text", () => {
    const faces = Array.from({ length: 40 }, (_, i) => 1 + Math.floor((i * FACE_COUNT) / 40));
    const belows = Array.from({ length: 20 }, (_, i) => 1 + Math.floor((i * BELOW_COUNT) / 20));
    for (const p of PERSONAS) {
      for (let i = 0; i < 40; i++) {
        const data = base(p, faces[i], belows[i % 20]);
        const input = buildInput(data, "thumb");
        const out = drawPage(input, { brand: null }, "thumb");
        expect(out.html.length).toBeGreaterThan(500);
        expect(out.html).not.toContain("Save contact");
        if (hasArabic(p.name)) expect(out.html).toContain('class="ar');
        expect(out.leaks).toBe(0);
      }
    }
  });
});

describe("Arabic names in the contact preview", () => {
  const src = {
    name: "محمد بن سالم الكواري", title: "المدير التنفيذي", company: "شركة الكواري للتجارة", address: "الدوحة، شارع الكورنيش",
    items: [{ kind: "Mobile" as const, value: "+974 5555 1111", label: "", on: true }],
    vc: { company: true, photo: false, phones: true, emails: true, urls: true, social: true, addr: true, note: "" },
    cardUrl: "https://ilaf.one/c/abc",
  };

  it("keeps the name, title and address as typed", () => {
    const p = previewFromCard(src);
    expect(p.name).toBe("محمد بن سالم الكواري");
    expect(p.subtitle).toBe("المدير التنفيذي - شركة الكواري للتجارة");
    expect(vcardFields(src).find((f) => f.t === "adr")?.v).toBe("الدوحة، شارع الكورنيش");
  });

  it("the preview file text reads back to the same contact", () => {
    const back = parseVcard(buildVcard(src));
    expect(back.name).toBe("محمد بن سالم الكواري");
    expect(back.subtitle).toContain("المدير التنفيذي");
  });
});

describe("Arabic names in the contact file text", () => {
  it("splits like the server and marks non-Latin text as UTF-8", async () => {
    const { splitContactName, vcardProp } = await import("./vcard");
    expect(splitContactName("محمد بن سالم الكواري")).toEqual(["الكواري", "محمد بن سالم"]);
    expect(splitContactName("عبدالله آل ثاني")).toEqual(["آل ثاني", "عبدالله"]);
    expect(splitContactName("Khalid Al Thani")).toEqual(["Al Thani", "Khalid"]);
    expect(splitContactName("فاطمة")).toEqual(["", "فاطمة"]);
    expect(vcardProp("FN", "محمد")).toBe("FN;CHARSET=UTF-8");
    expect(vcardProp("FN", "Zoë – Café")).toBe("FN");
    expect(vcardProp("ADR;TYPE=WORK", "الدوحة")).toBe("ADR;CHARSET=UTF-8;TYPE=WORK");
  });

  it("the QR contact carries the name as typed", async () => {
    const { buildQrContact } = await import("./qr-vcard");
    const q = buildQrContact({ name: "محمد بن سالم الكواري", title: "المدير", company: "الكواري", address: "", items: [{ kind: "Mobile", value: "+974 5555 1111" }] });
    expect(q.text).toContain("FN;CHARSET=UTF-8:محمد بن سالم الكواري");
    expect(q.text).toContain("N;CHARSET=UTF-8:الكواري;محمد بن سالم;;;");
    expect(q.bytes).toBeGreaterThan(q.text.length);
  });
});
