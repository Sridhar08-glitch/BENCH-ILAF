// Pure logic for departments and the company directory.
import type { Department, DepartmentDesign, MandatoryButton, Member } from "../types";
import { runtimeT, type I18n, type TFunction } from "../i18n";

/** The longest department name the API accepts. */
export const MAX_DEPARTMENT_NAME = 60;

/** Why a department name cannot be used, or null. Names are compared without case. */
export function nameProblem(name: string, others: Pick<Department, "id" | "name">[], editingId?: string | null, t: TFunction = runtimeT): string | null {
  const n = name.trim();
  if (!n) return t("company.nameEnter");
  if (n.length > MAX_DEPARTMENT_NAME) return t("company.nameLong", { max: MAX_DEPARTMENT_NAME });
  if (others.some((d) => d.id !== editingId && d.name.trim().toLowerCase() === n.toLowerCase())) return t("company.nameTaken");
  return null;
}

/** "Own design, 2 starting buttons, 1 required" for the department list. */
export function templateSummary(d: Pick<Department, "design" | "items" | "mandatory_items">, i18n: Pick<I18n, "t" | "list">): string {
  const { t, list } = i18n;
  const bits: string[] = [];
  bits.push(Object.keys(d.design ?? {}).length ? t("company.ownDesign") : t("company.companyDesign"));
  if (d.items.length) bits.push(t("company.startingButtons", { n: d.items.length }));
  if (d.mandatory_items.length) bits.push(t("company.requiredCount", { n: d.mandatory_items.length }));
  return list(bits);
}

/** A design that carries all six department-controlled keys. */
export function fullDesign(
  d: DepartmentDesign | undefined,
  company: { face: number; colour: number; below: number; intro: number; font?: string; size?: number },
): Required<DepartmentDesign> {
  return {
    face: d?.face ?? company.face, colour: d?.colour ?? company.colour, below: d?.below ?? company.below, intro: d?.intro ?? company.intro,
    font: d?.font ?? company.font ?? "face", size: d?.size ?? company.size ?? 100,
  };
}

/** Same button (kind and value) means the same button. */
export function sameButton(a: Pick<MandatoryButton, "kind" | "value">, b: Pick<MandatoryButton, "kind" | "value">): boolean {
  const v = (x: string) => x.trim().toLowerCase().replace(/\/+$/, "");
  return a.kind === b.kind && v(a.value) === v(b.value);
}

/** A button list is ready to save when every row has a value. Returns the first problem, or null. */
export function buttonsProblem(list: Pick<MandatoryButton, "kind" | "value">[], t: TFunction = runtimeT): string | null {
  const empty = list.findIndex((b) => !b.value.trim());
  if (empty >= 0) return t("company.buttonEmpty", { n: empty + 1 });
  return null;
}

/** Members per department, including people without one (key ""). */
export function countByDepartment(members: Pick<Member, "department_id">[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of members) {
    const k = m.department_id ?? "";
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/** Filter value for the team table: "all", "none" (no department) or a department id. */
export type DepartmentFilter = "all" | "none" | string;

export function matchesDepartment(m: Pick<Member, "department_id">, f: DepartmentFilter): boolean {
  if (f === "all") return true;
  if (f === "none") return !m.department_id;
  return m.department_id === f;
}
