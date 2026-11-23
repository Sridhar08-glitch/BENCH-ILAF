// The sample employees the brand page (and its preview tab) draws the company design on.
import { PUBLIC_HOST } from "@/lib/config";
import type { CardPageData, CompanyBrand } from "@/lib/library/types";
import { tk, type Locale, type MessageKey } from "@/lib/i18n";
import type { FullBrand } from "./state";

export const SAMPLE_ITEMS = [
  { kind: "Mobile", value: "+974 5555 0100", label: "", on: true },
  { kind: "Email", value: "name@company.com", label: "", on: true },
  { kind: "Website", value: "company.com", label: "", on: true },
  { kind: "LinkedIn", value: "linkedin.com/company/yours", label: "", on: true },
];

/** Sample employees: a normal one, one with a very long name and title, and one more. */
export const PEOPLE: { id: string; label: string; labelKey?: MessageKey; name: string; title: string }[] = [
  { id: "amira", label: "Amira Khalid", name: "Amira Khalid", title: "Head of Retail Banking" },
  { id: "maria", label: "", labelKey: tk("brand.sampleLongName"), name: "Maria Fernanda de los Santos Fernandez-Rodriguez", title: "Executive Vice President, International Corporate and Institutional Business Development" },
  { id: "daniel", label: "Daniel Okafor", name: "Daniel Okafor", title: "Senior Relationship Manager" },
];

export function personById(id: string) {
  return PEOPLE.find((p) => p.id === id) ?? PEOPLE[0];
}

/** What the card page needs to draw one sample employee in the company design. */
export function brandCardData(b: FullBrand, companyName: string, personId: string, brand: CompanyBrand | null, locale?: Locale): CardPageData {
  const who = personById(personId);
  return {
    name: who.name, title: who.title, company: companyName, address: "", photoUrl: null, coverUrl: null,
    publicUrl: `https://${PUBLIC_HOST}/c/sample`, saveContact: true, design: b.design, items: SAMPLE_ITEMS, footer: b.show_footer, brand, locale,
  };
}
