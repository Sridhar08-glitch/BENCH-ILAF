import { describe, expect, it } from "vitest";
import { mainPhone, normaliseText, parseCardText, tidyPhone } from "./parse";

/** Text as a camera reader returns it: stray symbols, wide gaps, mixed English and Arabic. */
const SAMPLES: { name: string; text: string; expect: Record<string, unknown> }[] = [
  {
    name: "classic English card",
    text: `SARA AL THANI
Head of Sales
Gulf Studio W.L.L
Tel: +974 4444 1234
Mobile: +974 5555 1234
sara@gulfstudio.example
www.gulfstudio.example
West Bay, Doha, Qatar`,
    expect: { name: "SARA AL THANI", title: "Head of Sales", company: "Gulf Studio W.L.L", phone: "+974 5555 1234", email: "sara@gulfstudio.example", website: "https://www.gulfstudio.example", addressHas: "West Bay" },
  },
  {
    name: "company on top, then the person",
    text: `GULF STUDIO
Creative Agency
John Smith
Senior Designer
M +971 50 123 4567
john.smith@gulfstudio.ae
gulfstudio.ae
Office 12, Business Bay Tower, Dubai`,
    expect: { name: "John Smith", title: "Senior Designer", company: "GULF STUDIO", phone: "+971 50 123 4567", email: "john.smith@gulfstudio.ae", website: "https://gulfstudio.ae", addressHas: "Business Bay Tower" },
  },
  {
    name: "bilingual English and Arabic",
    text: `سارة الثاني
Sara Al Thani
مديرة المبيعات
Sales Manager
شركة الخليج للتقنية
Gulf Technology Co.
+974 5555 1234
sara@gulftech.example`,
    expect: { name: "Sara Al Thani", altName: "سارة الثاني", title: "Sales Manager", altTitle: "مديرة المبيعات", company: "Gulf Technology Co.", altCompany: "شركة الخليج للتقنية", phone: "+974 5555 1234", email: "sara@gulftech.example" },
  },
  {
    name: "title and company on one line",
    text: `Omar Farouk
CEO at Nile Logistics
omar@nilelogistics.example
+20 100 123 4567`,
    expect: { name: "Omar Farouk", title: "CEO", company: "Nile Logistics", phone: "+20 100 123 4567", email: "omar@nilelogistics.example" },
  },
  {
    name: "labelled phones and a fax, P.O. box",
    text: `Dr. Layla Hassan
Consultant Cardiologist
Al Noor Medical Clinic
T: +974 4411 2233   F: +974 4411 2244
M: +974 6677 8899
E: layla.hassan@alnoor.example
P.O. Box 12345, Doha, Qatar`,
    expect: { name: "Dr. Layla Hassan", title: "Consultant Cardiologist", company: "Al Noor Medical Clinic", phone: "+974 6677 8899", phoneCount: 3, lastPhoneKind: "fax", email: "layla.hassan@alnoor.example", addressHas: "P.O. Box 12345" },
  },
  {
    name: "social handles and links",
    text: `Mike Johnson
Freelance Photographer
@mikeshots
instagram.com/mikeshots
linkedin.com/in/mike-johnson-photo
+44 7700 900123
mike@mikejohnson.photography
mikejohnson.photography`,
    expect: { name: "Mike Johnson", title: "Freelance Photographer", phone: "+44 7700 900123", email: "mike@mikejohnson.photography", website: "https://mikejohnson.photography", socials: ["Instagram:mikeshots", "LinkedIn:mike-johnson-photo"] },
  },
  {
    name: "very short card with a 00 number",
    text: `Ahmed Khan
Real Estate Broker
0097455001122
ahmed@khanproperties.example`,
    expect: { name: "Ahmed Khan", title: "Real Estate Broker", phone: "+97455001122", email: "ahmed@khanproperties.example" },
  },
  {
    name: "two columns read side by side",
    text: `Khalid Mansour          Mansour & Sons Trading
General Manager         www.mansour-trading.example
+971 4 123 4567         khalid@mansour-trading.example`,
    expect: { name: "Khalid Mansour", title: "General Manager", company: "Mansour & Sons Trading", phone: "+971 4 123 4567", email: "khalid@mansour-trading.example", website: "https://www.mansour-trading.example" },
  },
  {
    name: "floor and tower address across two lines",
    text: `Fatima Al Mannai
Marketing Director
Doha Tech Hub
Floor 5, Tower B, Lusail Boulevard
Lusail City, Qatar
Tel +974 4000 1111
fatima@dohatechhub.example`,
    expect: { name: "Fatima Al Mannai", title: "Marketing Director", company: "Doha Tech Hub", phone: "+974 4000 1111", email: "fatima@dohatechhub.example", addressHas: "Lusail Boulevard, Lusail City" },
  },
  {
    name: "Arabic only card",
    text: `محمد العلي
مدير تطوير الأعمال
Al Ali Group
+966 50 123 4567
m.alali@alaligroup.example
الرياض، المملكة العربية السعودية`,
    expect: { name: "محمد العلي", title: "مدير تطوير الأعمال", company: "Al Ali Group", phone: "+966 50 123 4567", email: "m.alali@alaligroup.example", addressHas: "الرياض" },
  },
  {
    name: "Eastern Arabic digits",
    text: `Yousef Ibrahim
Sales Executive
هاتف: ٠٠٩٧٤٥٥٥٥١٢٣٤
جوال: +٩٧٤ ٥٥٥٥ ١٢٣٤
yousef@example.com`,
    expect: { name: "Yousef Ibrahim", title: "Sales Executive", phoneCount: 1, phone: "+97455551234", email: "yousef@example.com" },
  },
  {
    name: "US layout with parentheses and a zip code",
    text: `Jennifer Lopez
VP of Engineering
Acme Corp.
(415) 555-0132
jlopez@acme.example
123 Market Street, Suite 400
San Francisco, CA 94105
acme.example`,
    expect: { name: "Jennifer Lopez", title: "VP of Engineering", company: "Acme Corp.", phone: "(415) 555-0132", email: "jlopez@acme.example", website: "https://acme.example", addressHas: "San Francisco, CA 94105" },
  },
  {
    name: "WhatsApp number and two websites",
    text: `Rashid Al Maktoum
Founder & CEO
Desert Rose Perfumes LLC
WhatsApp: +971 55 987 6543
rashid@desertrose.example
www.desertrose.example | shop.desertrose.example
Dubai Mall, Downtown Dubai`,
    expect: { name: "Rashid Al Maktoum", title: "Founder & CEO", company: "Desert Rose Perfumes LLC", phone: "+971 55 987 6543", firstPhoneKind: "mobile", email: "rashid@desertrose.example", websiteCount: 2, addressHas: "Dubai Mall" },
  },
  {
    name: "noisy symbols and an e-mail with spaces",
    text: `»  JOHN  DOE  «
Chief Technology Officer
||| NextGen Systems Inc. |||
T: +1 (212) 555-0198 •
j.doe @ nextgen.example
~~ www.nextgen.example ~~
5th Avenue, New York, USA`,
    expect: { name: "JOHN DOE", title: "Chief Technology Officer", company: "NextGen Systems Inc.", phone: "+1 (212) 555-0198", email: "j.doe@nextgen.example", website: "https://www.nextgen.example", addressHas: "5th Avenue" },
  },
  {
    name: "only a first name and a number",
    text: `Layla
0551234567`,
    expect: { name: "Layla", nameConfidence: "low", phone: "0551234567", phoneConfidence: "medium" },
  },
  {
    name: "title above the name, direct line with extension",
    text: `Chief Executive Officer
Hussain Al Sulaiti
Al Sulaiti Holding Group
Direct: +974 4488 7700 ext. 215
hussain@alsulaiti.example`,
    expect: { name: "Hussain Al Sulaiti", title: "Chief Executive Officer", company: "Al Sulaiti Holding Group", phone: "+974 4488 7700", email: "hussain@alsulaiti.example" },
  },
  {
    name: "cafe with a slogan",
    text: `GREEN LEAF CAFE
"Fresh. Local. Daily."
Maria Gonzalez
Owner
+34 612 345 678
hello@greenleaf.example
Calle Mayor 12, Madrid`,
    expect: { name: "Maria Gonzalez", title: "Owner", company: "GREEN LEAF CAFE", companyConfidence: "high", phone: "+34 612 345 678", email: "hello@greenleaf.example", addressHas: "Calle Mayor 12" },
  },
  {
    name: "French card",
    text: `Pierre Dubois
Directeur Commercial
Dubois & Fils SARL
Tél. +33 1 42 68 53 00
pierre.dubois@dubois-fils.example
12 Rue de la Paix, 75002 Paris`,
    expect: { name: "Pierre Dubois", title: "Directeur Commercial", company: "Dubois & Fils SARL", phone: "+33 1 42 68 53 00", email: "pierre.dubois@dubois-fils.example", addressHas: "Rue de la Paix" },
  },
  {
    name: "middle initial and a slash in the title",
    text: `Robert J. Miller
Attorney / Legal Advisor
Miller & Associates
(+965) 2222 3333
r.miller@miller-law.example`,
    expect: { name: "Robert J. Miller", title: "Attorney / Legal Advisor", company: "Miller & Associates", phone: "+965 2222 3333", email: "r.miller@miller-law.example" },
  },
  {
    name: "contact lines first, person last",
    text: `+966 11 234 5678
info@najdtrading.example
Najd Trading Est.
Abdullah Al Harbi
Sales Representative`,
    expect: { name: "Abdullah Al Harbi", title: "Sales Representative", company: "Najd Trading Est.", phone: "+966 11 234 5678", email: "info@najdtrading.example" },
  },
  {
    name: "company guessed from the website",
    text: `Nadia Karim
Interior Designer
+974 3333 4444
nadia@karimdesigns.example
www.karimdesigns.example`,
    expect: { name: "Nadia Karim", title: "Interior Designer", company: "Karimdesigns", companyConfidence: "low", phone: "+974 3333 4444" },
  },
];

function check(card: ReturnType<typeof parseCardText>, e: Record<string, unknown>) {
  if ("name" in e) expect(card.name).toBe(e.name);
  if ("title" in e) expect(card.title).toBe(e.title);
  if ("company" in e) expect(card.company).toBe(e.company);
  if ("altName" in e) expect(card.alt.name).toBe(e.altName);
  if ("altTitle" in e) expect(card.alt.title).toBe(e.altTitle);
  if ("altCompany" in e) expect(card.alt.company).toBe(e.altCompany);
  if ("phone" in e) expect(mainPhone(card)).toBe(e.phone);
  if ("phoneCount" in e) expect(card.phones).toHaveLength(e.phoneCount as number);
  if ("lastPhoneKind" in e) expect(card.phones[card.phones.length - 1].kind).toBe(e.lastPhoneKind);
  if ("firstPhoneKind" in e) expect(card.phones[0].kind).toBe(e.firstPhoneKind);
  if ("email" in e) expect(card.emails[0]).toBe(e.email);
  if ("website" in e) expect(card.websites[0]).toBe(e.website);
  if ("websiteCount" in e) expect(card.websites).toHaveLength(e.websiteCount as number);
  if ("addressHas" in e) expect(card.address).toContain(e.addressHas as string);
  if ("socials" in e) expect(card.social.map((s) => `${s.network}:${s.handle}`)).toEqual(e.socials);
  if ("nameConfidence" in e) expect(card.confidence.name).toBe(e.nameConfidence);
  if ("phoneConfidence" in e) expect(card.confidence.phone).toBe(e.phoneConfidence);
  if ("companyConfidence" in e) expect(card.confidence.company).toBe(e.companyConfidence);
}

describe("reading a paper business card", () => {
  it("has at least 15 realistic samples", () => {
    expect(SAMPLES.length).toBeGreaterThanOrEqual(15);
  });
  for (const s of SAMPLES) {
    it(s.name, () => {
      check(parseCardText(s.text), s.expect);
    });
  }
});

describe("confidence hints", () => {
  it("is high for what has a clear pattern and none for what is missing", () => {
    const c = parseCardText(SAMPLES[0].text);
    expect(c.confidence).toMatchObject({ name: "high", title: "high", company: "high", phone: "high", email: "high", website: "high", address: "medium" });
    const empty = parseCardText("Layla");
    expect(empty.confidence).toMatchObject({ title: "none", company: "none", phone: "none", email: "none", website: "none", address: "none", social: "none" });
  });
  it("is low for a company guessed from the layout", () => {
    expect(parseCardText("Nadia Karim\nwww.karimdesigns.example").confidence.company).toBe("low");
  });
});

describe("edge cases", () => {
  it("returns empty fields for empty or meaningless text", () => {
    for (const text of ["", "   \n  \n", "||| ~~ ***", "!!!"]) {
      const c = parseCardText(text);
      expect([c.name, c.title, c.company, c.address]).toEqual(["", "", "", ""]);
      expect([c.phones, c.emails, c.websites, c.social]).toEqual([[], [], [], []]);
    }
  });
  it("does not take a year, a postcode or a short number for a phone", () => {
    const c = parseCardText("Since 2009\nPO Box 4455\nZone 66");
    expect(c.phones).toEqual([]);
  });
  it("does not take an e-mail domain for a website", () => {
    const c = parseCardText("Sam Lee\nsam@lee.example");
    expect(c.websites).toEqual([]);
    expect(c.emails).toEqual(["sam@lee.example"]);
  });
  it("reads (at) and (dot) in e-mail addresses", () => {
    expect(parseCardText("Sam Lee\nsam (at) lee (dot) example").emails[0]).toBe("sam@lee.example");
  });
  it("keeps two different numbers and drops the same number written twice", () => {
    const c = parseCardText("Sam Lee\nM: +974 5555 1234\nMobile +974 55551234\nT: +974 4444 0000");
    expect(c.phones.map((p) => p.kind)).toEqual(["mobile", "office"]);
  });
  it("puts a fax last and never as the main number", () => {
    const c = parseCardText("Sam Lee\nFax: +974 4444 0001\nTel: +974 4444 0000");
    expect(mainPhone(c)).toBe("+974 4444 0000");
    expect(c.phones[c.phones.length - 1].kind).toBe("fax");
  });
  it("makes a name from the e-mail only as a last resort", () => {
    const c = parseCardText("sara.althani@example.com");
    expect(c.name).toBe("Sara Althani");
    expect(c.confidence.name).toBe("low");
  });
  it("copes with a very long text without hanging", () => {
    const text = Array.from({ length: 400 }, (_, i) => `Line number ${i} of some text`).join("\n");
    const t0 = Date.now();
    parseCardText(text);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe("helpers", () => {
  it("turns Arabic digits and odd spaces into plain ones", () => {
    expect(normaliseText("٠١٢٣٤٥٦٧٨٩   ۰۱۲")).toBe("0123456789   012");
  });
  it("tidies numbers", () => {
    expect(tidyPhone("00 974 5555 1234")).toBe("+974 5555 1234");
    expect(tidyPhone("(+965) 2222 3333")).toBe("+965 2222 3333");
    expect(tidyPhone(" 055-123-4567. ")).toBe("055-123-4567");
  });
});
