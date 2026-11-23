// Small words that the card designs print as decoration ("Call", "Mail", "Contact"). The designs are drawn in English;
// when a card is shown in another language these exact words are swapped for the language's own. A design whose
// theme words are not listed here keeps them in English. Only the text of an element is replaced, never an
// attribute or the owner's own text.
import type { Locale } from "@/lib/i18n/config";

type Words = Record<string, string>;

const AR: Words = {
  Mail: "بريد", MAIL: "بريد", Email: "بريد", Call: "اتصال", CALL: "اتصال", "Call mobile": "اتصال بالجوال",
  Meet: "موعد", Contact: "تواصل", CONTACT: "تواصل", Social: "التواصل الاجتماعي", SOCIAL: "التواصل الاجتماعي",
  Role: "المسمى", ROLE: "المسمى", Name: "الاسم", NAME: "الاسم", name: "الاسم", Phone: "الهاتف", phone: "الهاتف", Tel: "هاتف",
  "Tel.": "هاتف", TEL: "هاتف", Telephone: "هاتف", Web: "الموقع", WEB: "الموقع", Website: "الموقع الإلكتروني",
  Write: "اكتب", Follow: "تابع", FOLLOW: "تابع", Subject: "الموضوع", Booking: "الحجز", "Book a meeting": "حجز موعد",
  Profiles: "الحسابات", Welcome: "أهلًا بك", WELCOME: "أهلًا بك", Visit: "زيارة", View: "عرض", Where: "الموقع",
  From: "من", FROM: "من", To: "إلى", File: "ملف", Message: "رسالة", Date: "التاريخ", Company: "الشركة",
  Position: "المنصب", Notes: "ملاحظات", "Address book": "دفتر العناوين", Links: "روابط", Open: "فتح", OPEN: "فتح",
  "Tap to open": "المس للفتح", "Swipe for more": "اسحب للمزيد", "Say hello": "قل مرحبًا", "Say hello.": "قل مرحبًا.",
  Next: "التالي", Done: "تم", Edit: "تعديل", Help: "مساعدة", Options: "خيارات", Map: "الخريطة", Live: "مباشر", LIVE: "مباشر",
  Available: "متاح", Recent: "الأحدث", People: "الأشخاص", Reach: "تواصل", REACH: "تواصل", "In touch": "على تواصل",
  "To meet": "للقاء", "Need a pro?": "تحتاج إلى مختص؟", "Need a hand?": "تحتاج إلى مساعدة؟", "Ask me": "اسألني",
  "Or find me on social": "أو تجدني على وسائل التواصل", "Find me online:": "تجدني على الإنترنت:", "Please reply": "يُرجى الرد",
  "PLEASE CALL": "يُرجى الاتصال", "OR FIND ME": "أو تجدني على", "Warm regards,": "مع أطيب التحيات،", "Dear friend,": "عزيزي الصديق،",
  "Information": "معلومات", Detail: "تفاصيل", "New contact details": "بيانات التواصل الجديدة", "CONTACT RECEIPT": "إيصال التواصل",
  WhatsApp: "WhatsApp", TELEGRAM: "TELEGRAM",
};

export const CHROME_WORDS: Partial<Record<Locale, Words>> = { ar: AR };

/** Swap the decorative words of a drawn card page for the language's own. English (and any language without a list) is left as drawn. */
export function localiseWords(html: string, locale: Locale): string {
  const words = CHROME_WORDS[locale];
  if (!words) return html;
  return html.replace(/>([^<>]{2,40})</g, (all, text: string) => {
    const hit = words[text.trim()];
    return hit ? `>${text.replace(text.trim(), hit)}<` : all;
  });
}
