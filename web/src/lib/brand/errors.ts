// Plain-language sentences for a rejected brand save or upload. The API names the field in dotted form
// ("brand.artwork.pattern.opacity"); this turns it into words the owner understands.
import type { ApiError } from "@/lib/api";
import { tk, type I18n, type MessageKey } from "@/lib/i18n";
import { apiErrorText, apiFieldText } from "@/lib/i18n/api-error";

const LABELS: [RegExp, MessageKey][] = [
  [/^brand\.palette$/, tk("brand.fieldColours")],
  [/^brand\.colours/, tk("brand.fieldColours")],
  [/^brand\.design\.colour$/, tk("brand.fieldCompanyColours")],
  [/^brand\.design/, tk("brand.fieldDesign")],
  [/^brand\.logo_display$/, tk("brand.fieldLogoStyle")],
  [/^brand\.logo_placement$/, tk("brand.fieldLogoPlace")],
  [/^brand\.logo_corner$/, tk("brand.fieldLogoCorner")],
  [/^brand\.logo_chip$/, tk("brand.fieldLogoBacking")],
  [/^brand\.artwork\.background\.kind$/, tk("brand.fieldBgPicture")],
  [/^brand\.artwork\.background\.sample$/, tk("brand.fieldBgSample")],
  [/^brand\.artwork\.background\.strength$/, tk("brand.fieldBgStrength")],
  [/^brand\.artwork\.pattern\.opacity$/, tk("brand.fieldPatternOpacity")],
  [/^brand\.artwork\.pattern/, tk("brand.fieldPattern")],
  [/^brand\.artwork\.template\.kind$/, tk("brand.fieldTplPicture")],
  [/^brand\.artwork\.template\.sample$/, tk("brand.fieldTplSample")],
  [/^brand\.artwork\.template/, tk("brand.fieldTemplate")],
  [/^brand\.artwork/, tk("brand.fieldLook")],
  [/^brand\.company_name$/, tk("brand.fieldCompanyName")],
  [/^brand\.website$/, tk("brand.fieldWebsite")],
  [/^custom_domain$/, tk("brand.fieldDomain")],
  [/^name$/, tk("brand.fieldWorkspace")],
  [/^file$/, tk("brand.fieldPicture")],
];

/** "Brand colours: the text colour is hard to read on the card colour." for every field the API named. */
export function brandProblems(e: ApiError, t: I18n["t"]): string[] {
  const out: string[] = [];
  for (const [field, msgs] of Object.entries(e.fields)) {
    const key = LABELS.find(([re]) => re.test(field))?.[1];
    const message = (msgs[0] ? apiFieldText(e, field, t) ?? "" : "").trim();
    if (!message) continue;
    out.push(key ? t("brand.fieldProblem", { label: t(key), message }) : message);
  }
  return out;
}

/** One sentence for a save or upload that failed (the API's own message when it did not name a field). */
export function brandProblem(e: unknown, t: I18n["t"]): string {
  if (!e || typeof e !== "object" || !("fields" in e)) return t("brand.saveFailedTry");
  const err = e as ApiError;
  const list = brandProblems(err, t);
  if (list.length) return list.join(" ");
  return apiErrorText(err, t, "brand.saveFailedTry");
}
