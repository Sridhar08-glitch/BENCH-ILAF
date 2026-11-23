// Company sizes offered on the "Talk to us" form: the same list the API accepts (staff/public_views.py SIZES).
export const COMPANY_SIZES = ["1-5", "6-20", "21-50", "51-200", "200+"] as const;
export type CompanySize = (typeof COMPANY_SIZES)[number];

export function isCompanySize(v: string): v is CompanySize {
  return (COMPANY_SIZES as readonly string[]).includes(v);
}
