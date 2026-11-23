// Ten sample people for checking Arabic on the card designs: full Arabic, Arabic with a Latin company, mixed names,
// diacritics, very long names and addresses. Used by the tests and by the visual check (scripts/shoot-arabic.mjs).
export interface Persona {
  name: string;
  title: string;
  company: string;
  address: string;
}

export const PERSONAS: Persona[] = [
  { name: "محمد بن سالم الكواري", title: "المدير التنفيذي", company: "شركة الكواري للتجارة", address: "الدوحة، شارع الكورنيش، برج الأفق، الطابق 12" },
  { name: "فاطمة الهاجري", title: "مديرة التسويق", company: "مجموعة الدوحة القابضة", address: "لوسيل، شارع الوعب، مبنى 24" },
  { name: "عبدالله آل ثاني", title: "مستشار قانوني", company: "مكتب آل ثاني للمحاماة", address: "الدفنة، برج الصحافة، الطابق 8، الدوحة، قطر" },
  { name: "Khalid خالد Al Thani", title: "Chief Executive Officer المدير العام", company: "Qatar Gulf قطر الخليج", address: "West Bay, Doha - الخليج الغربي، الدوحة" },
  { name: "نورة المسند", title: "مهندسة برمجيات", company: "iLAF Technologies", address: "Msheireb Downtown, مشيرب قلب الدوحة" },
  { name: "يوسف الأنصاري", title: "مدير المبيعات الإقليمي لمنطقة الخليج العربي والشرق الأوسط", company: "شركة الأنصاري للمقاولات والتجارة العامة ذ.م.م", address: "الدوحة، المنطقة الصناعية، شارع 41، مبنى رقم 117، مكتب 5" },
  { name: "ريم عبدالرحمن المنصوري", title: "مصممة هوية بصرية", company: "ستوديو ريم", address: "أبوظبي، جزيرة الريم، برج الشمس" },
  { name: "سلطان بن خليفة", title: "رئيس مجلس الإدارة", company: "الخليفة للاستثمار", address: "الرياض، حي العليا" },
  { name: "مُحَمَّد الشَّرِيف", title: "طَبِيب أَسْنَان", company: "عِيَادَة الشَّرِيف", address: "الدوحة، شارع حمد الكبير" },
  { name: "Alice Anderson", title: "Designer", company: "Studio Anderson", address: "1 Main Street, Doha" },
];
