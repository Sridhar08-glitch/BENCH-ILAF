// Pure logic for field rules, approvals and the employee card editor's locked / approval hints.
import { EXTRA_KINDS, type ButtonPermissions, type ChangeRequest, type ExtraKind, type ExtrasMode, type FieldAccess, type FieldPermission, type FieldRules, type ItemKind, type MandatoryButton } from "../types";
import { runtimeT, tk, type I18n, type MessageKey, type TFunction } from "../i18n";

export type PlainField = "name" | "title" | "company" | "address" | "photo";

export const PLAIN_FIELDS: { id: PlainField; label: MessageKey }[] = [
  { id: "name", label: tk("company.fieldFullName") },
  { id: "title", label: tk("company.fieldJobTitle") },
  { id: "photo", label: tk("company.fieldPhoto") },
  { id: "company", label: tk("company.fieldCompanyLine") },
  { id: "address", label: tk("company.fieldAddress") },
];

export const PERMISSIONS: { id: FieldPermission; label: MessageKey }[] = [
  { id: "free", label: tk("company.permFree") },
  { id: "approval", label: tk("company.permApproval") },
  { id: "locked", label: tk("company.permLocked") },
];

export const permissionLabel = (p: FieldPermission, t: TFunction = runtimeT): string => {
  const found = PERMISSIONS.find((x) => x.id === p);
  return found ? t(found.label) : p;
};

const FIELD_WORD: Record<string, MessageKey> = {
  name: tk("company.wordName"), title: tk("company.wordTitle"), company: tk("company.wordCompany"),
  address: tk("company.wordAddress"), bio: tk("company.wordBio"), photo: tk("company.wordPhoto"), buttons: tk("company.wordButtons"),
};
/** The field's name as a word inside a sentence ("name", "job title"). */
export const fieldWordIn = (f: string, t: TFunction): string => (FIELD_WORD[f] ? t(FIELD_WORD[f]) : f);
/** The same in the current language, for code that has no translator at hand (safe to pass to map). */
export const fieldWord = (f: string): string => fieldWordIn(f, runtimeT);

/** The one-line hint under a field in the employee editor, or null when the field is free. */
export function fieldHint(field: PlainField | "bio", perm: FieldPermission, pending: boolean, t: TFunction = runtimeT): string | null {
  const word = fieldWordIn(field, t);
  if (pending) return t("company.hintPending", { word });
  if (perm === "locked") return t("company.hintLocked", { word });
  if (perm === "approval") return t("company.hintApproval", { word });
  return null;
}

/** What the Buttons tab should tell the employee, in one sentence, or null when buttons are free. */
export function buttonsHint(b: ButtonPermissions, i18n: Pick<I18n, "t" | "list"> = { t: runtimeT, list: (items) => items.join(", ") }): string | null {
  const { t, list } = i18n;
  const vals = [b.add, b.edit, b.remove];
  if (vals.every((v) => v === "free")) return null;
  if (vals.every((v) => v === "locked")) return t("company.btnHintAllLocked");
  const rules: [FieldPermission, MessageKey, MessageKey][] = [
    [b.add, tk("company.btnAddLocked"), tk("company.btnAddApproval")],
    [b.edit, tk("company.btnEditLocked"), tk("company.btnEditApproval")],
    [b.remove, tk("company.btnRemoveLocked"), tk("company.btnRemoveApproval")],
  ];
  const parts: string[] = [];
  for (const [v, locked, approval] of rules) {
    if (v === "locked") parts.push(t(locked));
    else if (v === "approval") parts.push(t(approval));
  }
  return t("company.btnHintRules", { parts: list(parts) });
}

export const buttonsAllLocked = (b: ButtonPermissions) => b.add === "locked" && b.edit === "locked" && b.remove === "locked";
/** Button changes are held and sent together for approval instead of saving as you type. */
export const buttonsNeedApproval = (b: ButtonPermissions) =>
  !buttonsAllLocked(b) && [b.add, b.edit, b.remove].includes("approval") && ![b.add, b.edit, b.remove].includes("locked");

/** Pending request for one field, if any. */
export function pendingFor(pending: { id: string; field: string }[] | undefined, field: string) {
  return pending?.find((p) => p.field === field) ?? null;
}

export function isKindAllowed(kind: ItemKind, allowed: ItemKind[] | null | undefined): boolean {
  return !allowed || allowed.includes(kind);
}

// ---- links and domains

/** The domain a typed link leads to, lower case, without www; "" when it has none. */
export function domainOf(value: string): string {
  let v = value.trim().toLowerCase();
  if (!v) return "";
  if (v.startsWith("mailto:")) v = v.slice(7);
  if (v.includes("@") && !v.includes("/")) return v.split("@").pop()!.replace(/^www\./, "");
  v = v.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  v = v.split(/[/?#]/)[0].split(":")[0];
  return v.replace(/^www\./, "");
}

/** The banned domain a link points at (a subdomain counts), or null. */
export function bannedHit(value: string, banned: string[] | undefined): string | null {
  const host = domainOf(value);
  if (!host || !banned) return null;
  return banned.find((d) => host === d || host.endsWith(`.${d}`)) ?? null;
}

/** Turn the textarea of banned domains (one per line, or comma separated) into a clean list. */
export function parseDomains(text: string): { domains: string[]; bad: string[] } {
  const domains: string[] = [];
  const bad: string[] = [];
  for (const raw of text.split(/[\n,;]/)) {
    const t = raw.trim();
    if (!t) continue;
    const d = domainOf(t);
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(d)) bad.push(t);
    else if (!domains.includes(d)) domains.push(d);
  }
  return { domains, bad };
}

// ---- the rules matrix

/** A copy of the rules with one key changed. */
export function withRule<K extends keyof FieldRules>(rules: FieldRules, key: K, value: FieldRules[K]): FieldRules {
  return { ...rules, [key]: value };
}

/** Only the keys that differ from the saved rules, so the save sends the smallest change. */
export function ruleChanges(saved: FieldRules, draft: FieldRules): Partial<FieldRules> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(draft) as (keyof FieldRules)[]) {
    if (JSON.stringify(saved[k]) !== JSON.stringify(draft[k])) out[k] = draft[k];
  }
  return out as Partial<FieldRules>;
}

/** Add a mandatory button once (same kind and value is the same button). */
export function addMandatory(list: MandatoryButton[], b: MandatoryButton): MandatoryButton[] {
  const key = (x: MandatoryButton) => `${x.kind}|${x.value.trim().toLowerCase().replace(/\/+$/, "")}`;
  return list.some((x) => key(x) === key(b)) ? list : [...list, b];
}

/** A plain sentence summing up the rules, for the page header. */
export function rulesSummary(r: FieldRules, i18n: Pick<I18n, "t" | "list">): string {
  const { t, list } = i18n;
  const fields = [r.name, r.title, r.photo, r.company, r.address, r.slug ?? "free", r.features ?? "free", r.vcard ?? "free"];
  const locked = fields.filter((f) => f === "locked").length;
  const approval = fields.filter((f) => f === "approval").length;
  const bits: string[] = [];
  if (locked) bits.push(t("company.rulesLocked", { n: locked }));
  if (approval) bits.push(t("company.rulesApproval", { n: approval }));
  if (r.mandatory_buttons.length) bits.push(t("company.rulesRequired", { n: r.mandatory_buttons.length }));
  if (r.banned_domains.length) bits.push(t("company.rulesBanned", { n: r.banned_domains.length }));
  if (r.allowed_kinds) bits.push(t("company.rulesKinds", { n: r.allowed_kinds.length }));
  return bits.length ? list(bits) : t("company.rulesNone");
}

// ---- change requests

interface ButtonValue {
  kind?: string;
  value?: string;
  label?: string;
  on?: boolean;
}

const shown = (b: ButtonValue) => b.on !== false && !!(b.value ?? "").trim();
const sig = (b: ButtonValue) => `${b.kind}|${(b.value ?? "").trim().toLowerCase()}`;

/** What a proposed button list changes compared with the current one, for the diff view. */
export function diffButtons(oldList: unknown, newList: unknown): { added: ButtonValue[]; removed: ButtonValue[] } {
  const a = (Array.isArray(oldList) ? oldList : []).filter(shown) as ButtonValue[];
  const b = (Array.isArray(newList) ? newList : []).filter(shown) as ButtonValue[];
  const sa = new Set(a.map(sig));
  const sb = new Set(b.map(sig));
  return { added: b.filter((x) => !sa.has(sig(x))), removed: a.filter((x) => !sb.has(sig(x))) };
}

export const buttonText = (b: ButtonValue) => `${b.label ? `${b.label}: ` : `${b.kind}: `}${b.value}`;

/** One short line saying what a request changes, for lists and the audit page. */
export function changeSummary(c: Pick<ChangeRequest, "field" | "old" | "new">, i18n: Pick<I18n, "t" | "list"> = { t: runtimeT, list: (items) => items.join(", ") }): string {
  const { t, list } = i18n;
  if (c.field === "photo") return t("company.changePhoto");
  if (c.field === "buttons") {
    const d = diffButtons(c.old, c.new);
    const parts: string[] = [];
    if (d.added.length) parts.push(t("company.changeAdd", { n: d.added.length }));
    if (d.removed.length) parts.push(t("company.changeRemove", { n: d.removed.length }));
    return parts.length ? t("company.changeButtons", { parts: list(parts) }) : t("company.changeButtonsSmall");
  }
  const show = (v: unknown) => (typeof v === "string" && v ? t("company.valueQuoted", { value: v }) : t("company.valueEmpty"));
  const word = fieldWordIn(c.field, t);
  return t("company.changeText", { field: `${word.charAt(0).toUpperCase()}${word.slice(1)}`, old: show(c.old), new: show(c.new) });
}

/** Word level difference of two texts for the diff view: parts marked as same, removed or added. */
export function textDiff(oldText: string, newText: string): { kind: "same" | "del" | "add"; text: string }[] {
  const a = oldText.split(/(\s+)/);
  const b = newText.split(/(\s+)/);
  // longest common subsequence on words (texts here are short)
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: { kind: "same" | "del" | "add"; text: string }[] = [];
  const push = (kind: "same" | "del" | "add", text: string) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { push("same", a[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { push("del", a[i]); i++; }
    else { push("add", b[j]); j++; }
  }
  while (i < n) push("del", a[i++]);
  while (j < m) push("add", b[j++]);
  return out;
}

/** The access object an editor falls back to when the API did not send one (everything free). */
export const FREE_ACCESS: FieldAccess = {
  name: "free", title: "free", photo: "free", company: "free", address: "free", slug: "free", features: "free", vcard: "free",
  buttons: { add: "free", edit: "free", remove: "free" },
  allowed_kinds: null, banned_domains: [], mandatory_buttons: [], extras: [...EXTRA_KINDS],
};

// ---- guards for the employee's button editor

interface ItemLike {
  kind: string;
  value: string;
  label?: string;
  on?: boolean;
}

const norm = (v: string) => v.trim().toLowerCase().replace(/\/+$/, "");
const visible = (i: ItemLike) => i.on !== false && i.value.trim() !== "";
const sameButtonItem = (a: ItemLike, b: Pick<MandatoryButton, "kind" | "value">) => a.kind === b.kind && norm(a.value) === norm(b.value);

/** The sentence to show when a change would remove, switch off or alter a required button. null when all is well. */
export function mandatoryProblem(next: ItemLike[], prev: ItemLike[], mandatory: MandatoryButton[], t: TFunction = runtimeT): string | null {
  for (const must of mandatory) {
    const had = prev.some((i) => visible(i) && sameButtonItem(i, must));
    const has = next.some((i) => visible(i) && sameButtonItem(i, must));
    if (had && !has) return t("company.mandatoryProblem", { name: must.label || must.kind });
  }
  return null;
}

/** The sentence to show when a visible button has a kind the company does not allow or points at a banned domain. */
export function linkProblem(items: ItemLike[], access: Pick<FieldAccess, "allowed_kinds" | "banned_domains">, t: TFunction = runtimeT): string | null {
  for (const i of items) {
    if (!visible(i)) continue;
    if (access.allowed_kinds && !access.allowed_kinds.includes(i.kind as ItemKind)) return t("company.kindNotAllowed", { kind: i.kind });
    const hit = bannedHit(i.value, access.banned_domains);
    if (hit) return t("company.domainNotAllowed", { domain: hit });
  }
  return null;
}

/** Whether this item is one of the required buttons (so the editor can mark it as locked). */
export function isRequired(i: ItemLike, mandatory: MandatoryButton[]): boolean {
  return mandatory.some((m) => visible(i) && sameButtonItem(i, m));
}

// ---- how much employees can change, as one choice

export type RightsPreset = "free" | "approval" | "locked";

/** The details of a person that need an admin's approval under the middle choice. */
const PERSON_FIELDS = ["name", "title", "photo", "company", "address"] as const;
const SETTING_FIELDS = ["slug", "features", "vcard", "button_add", "button_edit", "button_remove"] as const;

/** The rules a choice stands for. Only the permissions change: allowed button kinds, banned domains and required buttons are kept. */
export function presetRules(preset: RightsPreset, current: FieldRules): FieldRules {
  const next = { ...current };
  for (const k of PERSON_FIELDS) next[k] = preset === "free" ? "free" : preset === "approval" ? "approval" : "locked";
  for (const k of SETTING_FIELDS) next[k] = preset === "locked" ? "locked" : "free";
  return next;
}

/** Which choice the saved rules match, or null when they were set field by field. */
export function presetOf(rules: FieldRules): RightsPreset | null {
  for (const p of ["free", "approval", "locked"] as const) {
    const want = presetRules(p, rules);
    if ([...PERSON_FIELDS, ...SETTING_FIELDS].every((k) => want[k] === rules[k])) return p;
  }
  return null;
}

// ---- what employees may add under their cards

/** The extras a person may add: the list the API sent for them, or everything when it sent none. */
export function allowedExtras(access: Pick<FieldAccess, "extras"> | undefined): ExtraKind[] {
  return access?.extras ? [...access.extras] : [...EXTRA_KINDS];
}

/** The rules with the extras choice changed. "some" keeps the chosen kinds; "all" and "none" leave the list as it was. */
export function withExtras(rules: FieldRules, mode: ExtrasMode, kinds: readonly ExtraKind[] = rules.extra_kinds): FieldRules {
  return { ...rules, extras: mode, extra_kinds: EXTRA_KINDS.filter((k) => kinds.includes(k)) };
}

/** The extras a company allows its employees, from its rules. */
export function extrasOf(rules: Pick<FieldRules, "extras" | "extra_kinds">): ExtraKind[] {
  return rules.extras === "none" ? [] : rules.extras === "some" ? EXTRA_KINDS.filter((k) => rules.extra_kinds.includes(k)) : [...EXTRA_KINDS];
}
