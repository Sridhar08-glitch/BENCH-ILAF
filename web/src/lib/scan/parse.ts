// Turns the text read from a photo of a paper business card into fields. Pure and forgiving: text from a camera
// has stray symbols, broken lines and mixed English and Arabic, so every rule is a plain pattern or a simple guess,
// and every field says how sure the guess is. The review screen shows that, and the person fixes what is wrong.

export type Confidence = "high" | "medium" | "low" | "none";
export type PhoneKind = "mobile" | "office" | "fax" | "phone";

export interface ParsedPhone {
  value: string;
  kind: PhoneKind;
}

export interface ParsedSocial {
  network: string;
  handle: string;
  url: string;
}

export type FieldKey = "name" | "title" | "company" | "phone" | "email" | "website" | "address" | "social";

export interface ParsedCard {
  name: string;
  title: string;
  company: string;
  phones: ParsedPhone[];
  emails: string[];
  websites: string[];
  address: string;
  social: ParsedSocial[];
  /** The Arabic version of a field, when the card carries both languages. */
  alt: { name: string; title: string; company: string };
  confidence: Record<FieldKey, Confidence>;
  /** Lines that were not used for anything. */
  leftover: string[];
}

const ARABIC = /[؀-ۿݐ-ݿ]/;
const LATIN = /[A-Za-z]/;

/** Arabic-Indic and Persian digits become 0-9; odd spaces and dashes become plain ones. */
export function normaliseText(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[  -​  　‎‏‪-‮]/g, " ")
    .replace(/[‐-―−]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/\r\n?/g, "\n");
}

const TITLE_WORDS = [
  "manager", "director", "ceo", "cto", "cfo", "coo", "cio", "cmo", "founder", "co-founder", "cofounder", "president", "vice president", "vp",
  "head of", "head", "chief", "engineer", "developer", "designer", "consultant", "specialist", "officer", "executive", "partner", "lawyer",
  "advocate", "advisor", "adviser", "analyst", "architect", "accountant", "sales", "marketing", "owner", "chairman", "chairwoman", "supervisor",
  "coordinator", "assistant", "representative", "doctor", "surgeon", "dentist", "professor", "lecturer", "agent", "broker", "technician",
  "administrator", "secretary", "photographer", "producer", "editor", "trainer", "coach", "recruiter", "lead", "principal", "associate",
  "directeur", "directrice", "gerente", "gérant", "attorney", "cardiologist", "physician", "nurse", "pharmacist",
  "مدير", "مديرة", "رئيس", "رئيسة", "مهندس", "مهندسة", "مستشار", "مستشارة", "محاسب", "محاسبة", "مؤسس", "مؤسسة", "شريك", "طبيب", "طبيبة", "دكتور", "دكتورة", "مسؤول", "مسؤولة", "منسق", "مندوب", "محامي", "محامية", "مصمم", "مصممة", "مطور", "وسيط", "مشرف",
];
const TITLE_RE = new RegExp(`(^|[^\\p{L}])(${TITLE_WORDS.map((w) => w.replace(/[-]/g, "[- ]?")).join("|")})(?![\\p{L}])`, "iu");

const COMPANY_WORDS = [
  "ltd", "limited", "llc", "l.l.c", "w.l.l", "wll", "inc", "incorporated", "corp", "corporation", "co", "company", "group", "holding", "holdings", "trading",
  "solutions", "technologies", "technology", "tech", "studio", "studios", "agency", "consulting", "consultants", "services", "enterprises", "industries",
  "gmbh", "fze", "fzco", "pty", "plc", "sa", "sarl", "sas", "srl", "spa", "ag", "est", "bv", "cafe", "café", "restaurant", "hotel", "pharmacy", "salon", "bakery", "associates", "partners", "international", "systems", "labs", "media", "design", "properties",
  "realty", "real estate", "bank", "clinic", "academy", "university", "foundation", "ventures", "capital", "logistics", "contracting", "engineering",
  "شركة", "مؤسسة", "مجموعة", "للتجارة", "القابضة", "للخدمات", "للتقنية", "للعقارات", "مكتب", "بنك", "مصرف", "عيادة", "مركز",
];
const COMPANY_RE = new RegExp(`(^|[^\\p{L}])(${COMPANY_WORDS.map((w) => w.replace(/\./g, "\\.\\s?").replace(/ /g, "\\s")).join("|")})(?![\\p{L}])`, "iu");

const ADDRESS_WORDS = [
  "street", "st", "road", "rd", "avenue", "ave", "boulevard", "blvd", "tower", "building", "bldg", "floor", "fl", "suite", "ste", "office", "p\\.?o\\.?\\s?box", "box",
  "zone", "district", "area", "block", "plot", "unit", "level", "city", "bay", "park", "plaza", "centre", "center", "mall", "square", "lane", "drive",
  "highway", "po box", "next to", "opposite", "near",
  "شارع", "برج", "مبنى", "طابق", "الطابق", "ص\\.?ب", "منطقة", "حي", "مكتب رقم", "مجمع", "بناية", "ميدان", "طريق",
];
const ADDRESS_RE = new RegExp(`(^|[^\\p{L}])(${ADDRESS_WORDS.join("|")})(?![\\p{L}])`, "iu");
const PLACES = /\b(doha|qatar|dubai|abu dhabi|sharjah|uae|united arab emirates|riyadh|jeddah|saudi arabia|kuwait|bahrain|manama|muscat|oman|cairo|egypt|amman|jordan|beirut|lebanon|london|uk|united kingdom|new york|usa|united states|india|mumbai|delhi|pakistan|karachi|singapore|paris|france|berlin|germany|istanbul|turkey|west bay|lusail|al sadd)\b|الدوحة|قطر|دبي|أبوظبي|الرياض|جدة|الكويت|البحرين|مسقط|عمان|القاهرة|السعودية|الإمارات|لوسيل|الخليج الغربي/iu;

const PHONE_LABEL = /^\s*(?:(tel|tél|telephone|phone|ph|mobile|mob|cell|cellular|office|direct|fax|whatsapp|wa|m|t|f|o|p|هاتف|جوال|موبايل|محمول|فاكس|تلفون|واتساب|واتس اب)(?![\p{L}])\s*[:.\-/]?\s*)/iu;
const EMAIL_LABEL = /^\s*(?:(?:e-?mail|email|mail|e|بريد(?: إلكتروني)?|البريد(?: الإلكتروني)?)\s*[:\-]\s*|(?:e-?mail|email)\s+)/iu;
const WEB_LABEL = /^\s*(?:(?:website|web|site|url|w|الموقع(?: الإلكتروني)?|موقع)\s*[:\-]\s*|(?:website|web|site)\s+)(?=\S)/iu;
const ADDR_LABEL = /^\s*(?:address|addr|a|location|العنوان)\s*[:.\-]\s*/iu;

const EMAIL_RE = /[A-Za-z0-9._%+-]+\s?@\s?[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const URL_RE = /(?:https?:\/\/)?(?:www\.)?[A-Za-z0-9][A-Za-z0-9-]*(?:\.[A-Za-z0-9-]+)*\.(?:[A-Za-z]{2,24})(?::\d+)?(?:\/[^\s,;]*)?/g;
const PHONE_RE = /(?:\(?\+|\(?00)?\(?\d[\d\s().\-/]{5,}\d/g;

const SOCIALS: { network: string; hosts: string[]; build: (h: string) => string }[] = [
  { network: "LinkedIn", hosts: ["linkedin.com"], build: (h) => `https://linkedin.com/in/${h}` },
  { network: "Instagram", hosts: ["instagram.com", "instagr.am"], build: (h) => `https://instagram.com/${h}` },
  { network: "X", hosts: ["twitter.com", "x.com"], build: (h) => `https://x.com/${h}` },
  { network: "Facebook", hosts: ["facebook.com", "fb.com"], build: (h) => `https://facebook.com/${h}` },
  { network: "TikTok", hosts: ["tiktok.com"], build: (h) => `https://tiktok.com/@${h}` },
  { network: "YouTube", hosts: ["youtube.com", "youtu.be"], build: (h) => `https://youtube.com/@${h}` },
  { network: "GitHub", hosts: ["github.com"], build: (h) => `https://github.com/${h}` },
  { network: "Telegram", hosts: ["t.me"], build: (h) => `https://t.me/${h}` },
  { network: "Snapchat", hosts: ["snapchat.com"], build: (h) => `https://snapchat.com/add/${h}` },
];

function digitsOf(s: string): string {
  return s.replace(/\D/g, "");
}

/** Whether a stretch of digits looks like a telephone number and not a year, a postcode, a box number or an id. */
function phoneLike(raw: string, labelled: boolean): boolean {
  const d = digitsOf(raw);
  if (d.length < 7 || d.length > 15) return false;
  if (/^(19|20)\d{2}$/.test(d)) return false;
  const hasPlus = /^\s*(\+|00)/.test(raw);
  const separated = /[\s().\-/]/.test(raw.trim());
  if (hasPlus || labelled) return true;
  if (separated && d.length >= 8) return true;
  return d.length >= 8 && !separated;
}

/** "+974 5555 1234", "(050) 123 4567" and "0097455551234" in one tidy form. */
export function tidyPhone(raw: string): string {
  let s = raw.trim().replace(/[^\d+()\s.\-/]/g, "").replace(/\(\+(\d+)\)/g, "+$1").replace(/\s+/g, " ").trim();
  if (/^00(?!0)/.test(s)) s = `+${s.slice(2).trim()}`;
  s = s.replace(/^[.\-/\s]+|[.\-/\s]+$/g, "");
  // A bracket with no partner at the edge is noise from the photo; a pair like (415) stays.
  const open = (s.match(/\(/g) ?? []).length;
  const close = (s.match(/\)/g) ?? []).length;
  if (open > close) s = s.replace(/^\(/, "");
  if (close > open) s = s.replace(/\)$/, "");
  return s.trim();
}

function kindFromLabel(label: string): PhoneKind {
  const l = label.toLowerCase();
  if (/fax|فاكس|^f$/.test(l)) return "fax";
  if (/mob|cell|whatsapp|^wa$|^m$|جوال|موبايل|محمول|واتس/.test(l)) return "mobile";
  if (/tel|office|direct|^t$|^o$|هاتف|تلفون/.test(l)) return "office";
  return "phone";
}

function cleanLine(line: string): string {
  return line.replace(/[|•·▪■◆►»«_~=*^`]+/g, " ").replace(/\s+/g, " ").trim();
}

function isNoise(line: string): boolean {
  const letters = line.replace(/[^\p{L}\p{N}]/gu, "");
  return letters.length < 2;
}

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function hostOf(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split(/[/?#:]/)[0].toLowerCase();
}

function looksLikeName(line: string): boolean {
  const l = line.replace(/^(dr|eng|mr|mrs|ms|miss|prof|sheikh|sh|eng\.|dr\.)\.?\s+/i, "");
  if (/\d|@|\//.test(l) || l.length > 40) return false;
  if (TITLE_RE.test(l) || COMPANY_RE.test(l) || ADDRESS_RE.test(l) || PLACES.test(l)) return false;
  const words = l.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 4) return false;
  if (ARABIC.test(l)) return words.every((w) => /^[؀-ۿݐ-ݿ'-]+$/.test(w));
  return words.every((w) => /^(?:[A-Z][A-Za-z'’-]*\.?|[a-z]{1,3}|[A-Z]\.?)$/.test(w) || /^[A-Z][A-Za-z'’-]+$/.test(w) || /^[A-Z'’-]{2,}$/.test(w));
}

function isLatin(line: string): boolean {
  return LATIN.test(line) && !ARABIC.test(line);
}

/** Read the fields from the text of a card. */
export function parseCardText(input: string): ParsedCard {
  const confidence: Record<FieldKey, Confidence> = { name: "none", title: "none", company: "none", phone: "none", email: "none", website: "none", address: "none", social: "none" };
  const out: ParsedCard = {
    name: "", title: "", company: "", phones: [], emails: [], websites: [], address: "", social: [],
    alt: { name: "", title: "", company: "" }, confidence, leftover: [],
  };
  const text = normaliseText(input);
  // Columns read side by side by the camera arrive as one line with wide gaps: each part is its own line.
  let lines = text.split("\n").flatMap((l) => l.replace(/\s*[|•·▪■◆►]+\s*/g, "   ").split(/\s{3,}|\t+/)).map((l) => l.trim()).filter(Boolean);

  // ---- e-mail addresses (also "name (at) site.com" and "name @ site.com")
  const used = new Set<number>();
  lines = lines.map((l) => l.replace(/\s*[[(]\s*at\s*[\])]\s*/gi, "@").replace(/\s*[[(]\s*dot\s*[\])]\s*/gi, "."));
  lines.forEach((line, i) => {
    const body = line.replace(EMAIL_LABEL, "");
    const found = body.match(EMAIL_RE);
    if (!found) return;
    for (const f of found) {
      const email = f.replace(/\s/g, "").replace(/[.,;:]+$/, "").toLowerCase();
      if (!out.emails.includes(email)) out.emails.push(email);
    }
    const rest = cleanLine(body.replace(EMAIL_RE, " ")).replace(/^[\s:;,/-]+|[\s:;,/-]+$/g, "");
    lines[i] = rest;
    if (!rest || isNoise(rest)) used.add(i);
  });
  if (out.emails.length) confidence.email = "high";

  // ---- social links and handles
  const addSocial = (network: string, handle: string, url: string) => {
    if (!handle || out.social.some((s) => s.network === network && s.handle.toLowerCase() === handle.toLowerCase())) return;
    out.social.push({ network, handle, url });
  };
  lines.forEach((line, i) => {
    if (used.has(i)) return;
    let rest = line;
    for (const m of line.match(URL_RE) ?? []) {
      const host = hostOf(m);
      const net = SOCIALS.find((s) => s.hosts.some((h) => host === h || host.endsWith(`.${h}`)));
      if (!net) continue;
      const path = m.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/").slice(1).filter(Boolean);
      const handle = (net.network === "LinkedIn" ? path[1] ?? path[0] : path[0] ?? "").replace(/^@/, "").replace(/[?#].*$/, "");
      if (handle) addSocial(net.network, handle, net.build(handle));
      rest = rest.replace(m, " ");
    }
    // A lone @handle (not an e-mail) is a social handle; the network is unknown, so it is kept as is.
    const h = /(?:^|\s)@([A-Za-z0-9_.]{3,30})(?=\s|$)/.exec(rest);
    if (h && !/@[\w.-]+\.[a-z]{2,}/i.test(rest)) {
      const labelled = /(insta|ig|snap|twitter|tiktok|x)\b/i.exec(line)?.[1]?.toLowerCase();
      const net = labelled?.startsWith("insta") || labelled === "ig" ? SOCIALS[1] : labelled?.startsWith("snap") ? SOCIALS[8] : labelled?.startsWith("twitter") || labelled === "x" ? SOCIALS[2] : labelled === "tiktok" ? SOCIALS[4] : null;
      if (net) addSocial(net.network, h[1], net.build(h[1]));
      else addSocial("Social", h[1], "");
      rest = rest.replace(h[0], " ");
    }
    if (rest !== line) {
      lines[i] = cleanLine(rest).replace(/^(insta(?:gram)?|ig|twitter|linkedin|facebook|fb|snap(?:chat)?|tiktok)\s*[:.\-]?\s*/i, "");
      if (!lines[i] || isNoise(lines[i])) used.add(i);
    }
  });
  if (out.social.length) confidence.social = "high";

  // ---- websites
  lines.forEach((line, i) => {
    if (used.has(i)) return;
    const labelled = WEB_LABEL.test(line);
    const body = line.replace(WEB_LABEL, "");
    const found = body.match(URL_RE);
    if (!found) return;
    let rest = body;
    let any = false;
    for (const m of found) {
      const host = hostOf(m);
      // Not a number with a dot (3.5), not a file name, and the end must look like a real top-level domain.
      if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,24}$/.test(host) || /\.(png|jpe?g|gif|pdf|docx?)$/.test(host)) continue;
      if (!labelled && !/^https?:\/\//i.test(m) && !/^www\./i.test(m) && body.trim().split(/\s+/).length > 2 && !/\.(com|net|org|io|co|qa|ae|sa|app|dev|me|info|biz|uk|de|fr|in)(\/|$)/.test(host)) continue;
      const url = /^https?:\/\//i.test(m) ? m : `https://${m.replace(/^www\./i, "www.")}`;
      const clean = url.replace(/[.,;:]+$/, "");
      if (!out.websites.includes(clean.toLowerCase().replace(/\/$/, ""))) out.websites.push(clean.toLowerCase().replace(/\/$/, ""));
      rest = rest.replace(m, " ");
      any = true;
    }
    if (any) {
      lines[i] = cleanLine(rest);
      if (!lines[i] || isNoise(lines[i])) used.add(i);
    }
  });
  if (out.websites.length) confidence.website = "high";

  // ---- phone numbers
  lines.forEach((line, i) => {
    if (used.has(i)) return;
    const label = PHONE_LABEL.exec(line);
    const labelled = !!label;
    const kindWord = label?.[1] ?? "";
    // Several labelled numbers can share one line: "T: 4444 5555  M: 5555 1234".
    const segments = line.split(/(?=(?:tel|phone|mobile|mob|cell|fax|office|direct|whatsapp|هاتف|جوال|فاكس)(?![\p{L}])\s*[:.\-/])|(?=\s[TMFO]\s*[:.]\s*[+\d(])/iu);
    let consumed = false;
    for (const seg of segments) {
      const l = PHONE_LABEL.exec(seg);
      const body = seg.replace(PHONE_LABEL, "");
      const nums = body.match(PHONE_RE);
      if (!nums) continue;
      for (const n of nums) {
        if (ADDRESS_RE.test(seg) && !/^\s*(\+|00)/.test(n) && !l) continue;
        if (!phoneLike(n, !!l || labelled)) continue;
        const value = tidyPhone(n);
        if (!out.phones.some((p) => digitsOf(p.value) === digitsOf(value))) out.phones.push({ value, kind: kindFromLabel(l?.[1] ?? kindWord) });
        consumed = true;
      }
    }
    if (consumed) {
      const stripped = cleanLine(line.replace(PHONE_RE, " ").replace(new RegExp(PHONE_LABEL.source, "giu"), " "));
      lines[i] = stripped.replace(/^[\s:;,/-]+|[\s:;,/-]+$/g, "");
      if (!lines[i] || isNoise(lines[i])) used.add(i);
    }
  });
  if (out.phones.length) confidence.phone = out.phones.some((p) => p.value.startsWith("+")) ? "high" : "medium";
  // A mobile that is first among equals is the one to use as "the phone".
  out.phones.sort((a, b) => (a.kind === "mobile" ? -1 : 0) - (b.kind === "mobile" ? -1 : 0) || (a.kind === "fax" ? 1 : 0) - (b.kind === "fax" ? 1 : 0));

  // ---- address: lines with street words, box numbers or well known places, plus the line next to them
  const rest = lines.map((l, i) => ({ l: cleanLine(l.replace(ADDR_LABEL, "")), i, hadLabel: ADDR_LABEL.test(l) })).filter((x) => !used.has(x.i) && !isNoise(x.l));
  const addrIdx = new Set<number>();
  rest.forEach((x, k) => {
    const placeOnly = PLACES.test(x.l) && !COMPANY_RE.test(x.l) && !TITLE_RE.test(x.l);
    const zipLine = /\b(?:[A-Z]{2}\s)?\d{5}(?:-\d{4})?\b/.test(x.l) && LATIN.test(x.l);
    const numbered = /\d/.test(x.l) && /,/.test(x.l) && !COMPANY_RE.test(x.l) && !TITLE_RE.test(x.l);
    if (x.hadLabel || ADDRESS_RE.test(x.l) || placeOnly || zipLine || numbered) addrIdx.add(k);
  });
  // A line between two address lines is part of the address too ("West Bay" between a tower and a city).
  rest.forEach((_, k) => {
    if (!addrIdx.has(k) && addrIdx.has(k - 1) && addrIdx.has(k + 1) && !looksLikeName(rest[k].l) && !TITLE_RE.test(rest[k].l)) addrIdx.add(k);
  });
  const addrLines = rest.filter((_, k) => addrIdx.has(k));
  if (addrLines.length) {
    out.address = addrLines.map((x) => x.l.replace(/[,;]\s*$/, "")).join(", ");
    confidence.address = addrLines.some((x) => x.hadLabel) || addrLines.length >= 2 ? "high" : "medium";
  }
  const remaining = rest.filter((_, k) => !addrIdx.has(k)).map((x) => x.l);

  // ---- title, name, company from what is left
  const titleLike = (l: string) => (TITLE_RE.test(l) && !COMPANY_RE.test(l.replace(TITLE_RE, " "))) || (TITLE_RE.test(l) && l.split(/\s+/).length <= 6);
  const latinTitle = remaining.findIndex((l) => isLatin(l) && titleLike(l));
  const titleIdx = latinTitle >= 0 ? latinTitle : remaining.findIndex((l) => titleLike(l));
  let titleLine = titleIdx >= 0 ? remaining[titleIdx] : "";
  let companyFromTitle = "";
  if (titleLine) {
    // "Sales Manager | Gulf Studio", "CEO at Gulf Studio" and "Manager, Gulf Studio" carry both.
    const parts = titleLine.split(/\s+(?:at|@)\s+|\s+-\s+|\s*,\s*|\s{2,}/i).map((p) => p.trim()).filter(Boolean);
    if (parts.length === 2) {
      const [a, b] = parts;
      if (TITLE_RE.test(a) && !TITLE_RE.test(b)) { titleLine = a; companyFromTitle = b; }
      else if (TITLE_RE.test(b) && !TITLE_RE.test(a)) { titleLine = b; companyFromTitle = a; }
    }
  }
  if (titleIdx >= 0) {
    out.title = isLatin(titleLine) || !ARABIC.test(titleLine) ? titleLine : "";
    if (ARABIC.test(titleLine) && !out.title) out.alt.title = titleLine;
    confidence.title = "high";
  }

  const claimed = new Set<number>();
  if (titleIdx >= 0) claimed.add(titleIdx);
  // Find the Arabic title that sits beside an English one.
  if (out.title) {
    const ar = remaining.findIndex((l, k) => !claimed.has(k) && ARABIC.test(l) && TITLE_RE.test(l));
    if (ar >= 0) { out.alt.title = remaining[ar]; claimed.add(ar); }
  }

  // Name: the line right above the title if it fits, else the first line that looks like a person's name (English first).
  const candidates = remaining.map((l, k) => ({ l, k })).filter(({ l, k }) => !claimed.has(k) && looksLikeName(l));
  let nameCand = candidates.find(({ k }) => titleIdx >= 0 && (k === titleIdx - 1 || k === titleIdx + 1) && isLatin(remaining[k]));
  if (!nameCand) nameCand = candidates.find(({ l }) => isLatin(l));
  if (!nameCand) nameCand = candidates[0];
  if (nameCand) {
    if (ARABIC.test(nameCand.l)) out.alt.name = nameCand.l;
    else out.name = nameCand.l;
    claimed.add(nameCand.k);
    confidence.name = nameCand.k === titleIdx - 1 || nameCand.k === titleIdx + 1 || nameCand.k === 0 ? "high" : "medium";
    const ar = candidates.find(({ l, k }) => !claimed.has(k) && ARABIC.test(l));
    if (ar && !ARABIC.test(nameCand.l)) { out.alt.name = ar.l; claimed.add(ar.k); }
  }

  // Company: a line with a company word, or what the title line carried, or the biggest leftover line.
  const companyLine = (l: string, k: number) => !claimed.has(k) && COMPANY_RE.test(l) && !looksLikeName(l);
  let companyIdx = remaining.findIndex((l, k) => isLatin(l) && companyLine(l, k));
  if (companyIdx < 0) companyIdx = remaining.findIndex((l, k) => companyLine(l, k));
  // A card with one capitalised word and no company line is a first name.
  if (!out.name && !out.alt.name && companyIdx < 0 && !companyFromTitle) {
    const single = remaining.findIndex((l, k) => !claimed.has(k) && /^[A-Z][a-z]+$/.test(l));
    if (single >= 0) {
      out.name = remaining[single];
      confidence.name = "low";
      claimed.add(single);
    }
  }
  if (companyFromTitle) {
    out.company = companyFromTitle;
    confidence.company = COMPANY_RE.test(companyFromTitle) ? "high" : "medium";
  } else if (companyIdx >= 0) {
    out.company = remaining[companyIdx];
    confidence.company = "high";
    claimed.add(companyIdx);
  } else {
    // A slogan has sentence punctuation or quotes; a company name does not.
    const guess = remaining.findIndex((l, k) => !claimed.has(k) && l.length >= 3 && l.length <= 50 && isLatin(l) && !/[.!?"“”]/.test(l) && !/[a-z]{3,} [a-z]{3,} [a-z]{3,} [a-z]{3,}/.test(l));
    if (guess >= 0) {
      out.company = remaining[guess];
      confidence.company = "low";
      claimed.add(guess);
      companyIdx = guess;
    }
  }
  const arCompany = remaining.findIndex((l, k) => !claimed.has(k) && ARABIC.test(l) && !looksLikeName(l));
  if (arCompany >= 0 && (out.company || COMPANY_RE.test(remaining[arCompany]))) {
    if (!out.company && ARABIC.test(remaining[arCompany])) out.company = remaining[arCompany];
    else out.alt.company = remaining[arCompany];
    claimed.add(arCompany);
  }
  // No company line but a website: the site's name is a likely company name.
  if (!out.company && out.websites.length) {
    const label = hostOf(out.websites[0]).split(".")[0];
    if (label.length >= 3) {
      out.company = label.replace(/[-_]+/g, " ").split(" ").map(titleCase).join(" ");
      confidence.company = "low";
    }
  }
  // A title that landed in the name slot (one word names like "Sara") is not recoverable; leave the name for the person to fix.
  if (!out.name && !out.alt.name) {
    const single = remaining.findIndex((l, k) => !claimed.has(k) && /^[A-Z][a-z]+$/.test(l));
    if (single >= 0) { out.name = remaining[single]; confidence.name = "low"; claimed.add(single); }
  }
  // A card in Arabic only: the Arabic text is the value.
  for (const f of ["name", "title", "company"] as const) {
    if (!out[f] && out.alt[f]) {
      out[f] = out.alt[f];
      out.alt[f] = "";
    }
  }
  if (!out.name && out.emails.length) {
    // The e-mail's first part is a last resort: sara.althani@ -> Sara Althani
    const local = out.emails[0].split("@")[0];
    if (/^[a-z]+[._-][a-z]+$/.test(local)) { out.name = local.split(/[._-]/).map(titleCase).join(" "); confidence.name = "low"; }
  }
  out.social = out.social.filter((s) => s.network !== "Social" || !out.social.some((o) => o.network !== "Social" && o.handle.toLowerCase() === s.handle.toLowerCase()));
  out.leftover = remaining.filter((_, k) => !claimed.has(k) && remaining[k] !== out.company);
  return out;
}

/** The first phone to use as the main number, preferring mobiles and never a fax. */
export function mainPhone(p: ParsedCard): string {
  return (p.phones.find((x) => x.kind !== "fax") ?? p.phones[0])?.value ?? "";
}
