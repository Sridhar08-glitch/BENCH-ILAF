import { describe, expect, it } from "vitest";
import type { Department, FieldRules, ItemKind, Member } from "../types";
import { MAX_BULK, allSelected, confirmText as confirmTextT, failures, groupReasons as groupReasonsT, memberActions, memberSelectable, pruneSelection, selectAll, summarize as summarizeT, toggleId } from "./bulk";
import { canConfirmRemoval, reassignTargets, removalOptions, targetProblem as targetProblemT } from "./offboarding";
import {
  FREE_ACCESS, addMandatory, bannedHit, buttonsAllLocked, buttonsHint as buttonsHintT, buttonsNeedApproval, changeSummary as changeSummaryT, diffButtons, domainOf, fieldHint as fieldHintT,
  isKindAllowed, isRequired, linkProblem as linkProblemT, mandatoryProblem as mandatoryProblemT, parseDomains, pendingFor, ruleChanges, rulesSummary as rulesSummaryT, textDiff,
} from "./fields";
import { EMPTY_FILTERS, actorName as actorNameT, describeEvent as describeEventT, hasFilters, lastDays, queryOf, rangeProblem as rangeProblemT } from "./audit";
import { buttonsProblem as buttonsProblemT, countByDepartment, fullDesign, matchesDepartment, nameProblem as nameProblemT, sameButton, templateSummary as templateSummaryT } from "./departments";
import { directoryMeta as directoryMetaT, directoryQuery, directorySlugProblem as directorySlugProblemT, directoryUrl, normaliseDirectorySlug, parsePage, resultsLine as resultsLineT } from "./directory";
import { createI18n } from "../i18n";
import { en } from "../i18n/messages";

// The English translator, with the list joined by commas as these tests expect.
const i18n = { ...createI18n("en", "latn", en), list: (items: string[]) => items.join(", ") };
const tt = i18n.t;
const confirmText = (kind: "members" | "cards", action: string, n: number, extra?: { role?: string; department?: string | null }) => confirmTextT(kind, action, n, extra, tt);
const summarize = (r: Parameters<typeof summarizeT>[0]) => summarizeT(r, tt);
const groupReasons = (r: Parameters<typeof groupReasonsT>[0]) => groupReasonsT(r, tt);
const targetProblem = (m: Member[], id?: string | null) => targetProblemT(m, id, tt);
const fieldHint = (f: Parameters<typeof fieldHintT>[0], p: Parameters<typeof fieldHintT>[1], pending: boolean) => fieldHintT(f, p, pending, tt);
const buttonsHint = (b: Parameters<typeof buttonsHintT>[0]) => buttonsHintT(b, i18n);
const rulesSummary = (r: FieldRules) => rulesSummaryT(r, i18n);
const changeSummary = (c: Parameters<typeof changeSummaryT>[0]) => changeSummaryT(c, i18n);
const rangeProblem = (f: Parameters<typeof rangeProblemT>[0]) => rangeProblemT(f, tt);
const describeEvent = (e: Parameters<typeof describeEventT>[0]) => describeEventT(e, i18n);
const actorName = (e: Parameters<typeof actorNameT>[0]) => actorNameT(e, tt);
const nameProblem = (name: string, others: Parameters<typeof nameProblemT>[1], id?: string | null) => nameProblemT(name, others, id, tt);
const templateSummary = (d: Parameters<typeof templateSummaryT>[0]) => templateSummaryT(d, i18n);
const buttonsProblem = (l: Parameters<typeof buttonsProblemT>[0]) => buttonsProblemT(l, tt);
const directorySlugProblem = (raw: string) => directorySlugProblemT(raw, tt);
const directoryMeta = (c: string, n: number) => directoryMetaT(c, n, tt);
const resultsLine = (count: number, total: number, hasFilter: boolean) => resultsLineT(count, total, hasFilter, tt);
const mandatoryProblem = (a: Parameters<typeof mandatoryProblemT>[0], b: Parameters<typeof mandatoryProblemT>[1], c: Parameters<typeof mandatoryProblemT>[2]) => mandatoryProblemT(a, b, c, tt);
const linkProblem = (items: Parameters<typeof linkProblemT>[0], access: Parameters<typeof linkProblemT>[1]) => linkProblemT(items, access, tt);

const member = (over: Partial<Member>): Member => ({
  id: "m1", user: null, email: "a@x.com", full_name: "", role: "employee", status: "active", card_id: null,
  invited_at: "", joined_at: null, ...over,
});

describe("selection", () => {
  it("toggles ids and keeps the pick order", () => {
    expect(toggleId(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleId(["a", "b"], "a")).toEqual(["b"]);
  });
  it("selects at most the bulk limit and can clear", () => {
    const ids = Array.from({ length: 250 }, (_, i) => String(i));
    expect(selectAll(ids, true)).toHaveLength(MAX_BULK);
    expect(selectAll(ids, false)).toEqual([]);
  });
  it("drops ids that vanished and knows when everything visible is picked", () => {
    expect(pruneSelection(["a", "b", "c"], ["b", "c", "d"])).toEqual(["b", "c"]);
    expect(allSelected(["a", "b"], ["a", "b"])).toBe(true);
    expect(allSelected(["a"], ["a", "b"])).toBe(false);
    expect(allSelected([], [])).toBe(false);
  });
  it("never offers the owner, and offers admins only to the owner", () => {
    expect(memberSelectable({ role: "owner" }, true)).toBe(false);
    expect(memberSelectable({ role: "admin" }, false)).toBe(false);
    expect(memberSelectable({ role: "admin" }, true)).toBe(true);
    expect(memberSelectable({ role: "employee" }, false)).toBe(true);
  });
});

describe("bulk actions", () => {
  it("shows the role change only to the owner", () => {
    expect(memberActions(true).map((a) => a.id)).toContain("role");
    expect(memberActions(false).map((a) => a.id)).not.toContain("role");
    expect(memberActions(false).find((a) => a.id === "remove")?.danger).toBe(true);
  });
  it("writes the confirmation with the counts", () => {
    expect(confirmText("members", "publish", 1)).toContain("the card of 1 person");
    expect(confirmText("members", "publish", 5)).toContain("the cards of 5 people");
    expect(confirmText("members", "suspend", 3)).toContain("Suspend 3 people");
    expect(confirmText("cards", "delete", 1)).toContain("Delete 1 card for good");
    expect(confirmText("members", "role", 2, { role: "admin" })).toContain("Make 2 people admins");
    expect(confirmText("members", "department", 2, { department: "Sales" })).toBe("Move 2 people to Sales?");
    expect(confirmText("members", "department", 1, { department: null })).toContain("Take 1 person out");
    expect(confirmText("members", "remove", 4)).toContain("Leads always stay");
  });
  it("sums up a run", () => {
    expect(summarize({ total: 4, ok: 4, failed: 0 })).toBe("All 4 done.");
    expect(summarize({ total: 4, ok: 3, failed: 1 })).toBe("3 done, 1 refused.");
    expect(summarize({ total: 2, ok: 0, failed: 2 })).toBe("None done. 2 refused.");
    expect(summarize({ total: 0, ok: 0, failed: 0 })).toBe("Nothing to do.");
  });
  it("groups refusals by reason", () => {
    const results = [
      { id: "1", name: "Ann", ok: false, reason: "Already published.", code: "x" },
      { id: "2", name: "Bob", ok: true, reason: null, code: null },
      { id: "3", name: "Cy", ok: false, reason: "Already published.", code: "x" },
      { id: "4", name: "", ok: false, reason: null, code: null },
    ];
    expect(failures({ results })).toHaveLength(3);
    expect(groupReasons({ results })).toEqual([
      { reason: "Already published.", names: ["Ann", "Cy"] },
      { reason: "Refused.", names: ["Unknown"] },
    ]);
  });
});

describe("offboarding", () => {
  const list = [member({ id: "a", card_id: "c1" }), member({ id: "b" }), member({ id: "c", card_id: null })];
  it("offers only colleagues without a card, not the person leaving", () => {
    expect(reassignTargets(list, "b").map((m) => m.id)).toEqual(["c"]);
    expect(reassignTargets(list).map((m) => m.id)).toEqual(["b", "c"]);
  });
  it("explains an empty picker", () => {
    expect(targetProblem(list, "b")).toBeNull();
    expect(targetProblem([member({ id: "a", card_id: "c" })], "z")).toContain("Everyone already has a card");
  });
  it("needs a choice before handing a card on", () => {
    expect(canConfirmRemoval("keep", null, true)).toBe(true);
    expect(canConfirmRemoval("reassign", null, true)).toBe(false);
    expect(canConfirmRemoval("reassign", "nobody", true)).toBe(true);
    expect(canConfirmRemoval("reassign", null, false)).toBe(true);
  });
  it("builds the API options", () => {
    expect(removalOptions("keep", null)).toEqual({ card: "keep", reassign_to: null });
    expect(removalOptions("delete", "x")).toEqual({ card: "delete", reassign_to: null });
    expect(removalOptions("reassign", "x")).toEqual({ card: "reassign", reassign_to: "x" });
    expect(removalOptions("reassign", "nobody")).toEqual({ card: "reassign", reassign_to: null });
  });
});

describe("field hints", () => {
  it("says nothing for a free field and explains the others", () => {
    expect(fieldHint("title", "free", false)).toBeNull();
    expect(fieldHint("title", "locked", false)).toContain("Your company sets the job title");
    expect(fieldHint("photo", "approval", false)).toContain("checked by an admin");
    expect(fieldHint("name", "approval", true)).toContain("waiting for an admin");
  });
  it("describes the button rules", () => {
    expect(buttonsHint({ add: "free", edit: "free", remove: "free" })).toBeNull();
    expect(buttonsHint({ add: "locked", edit: "locked", remove: "locked" })).toContain("cannot add, change or remove");
    expect(buttonsHint({ add: "approval", edit: "free", remove: "locked" })).toBe("Your company has rules for buttons: adding a button needs approval, removing a button is not allowed.");
  });
  it("knows when button edits are held for approval", () => {
    expect(buttonsNeedApproval({ add: "approval", edit: "free", remove: "free" })).toBe(true);
    expect(buttonsNeedApproval({ add: "approval", edit: "locked", remove: "free" })).toBe(false);
    expect(buttonsNeedApproval(FREE_ACCESS.buttons)).toBe(false);
    expect(buttonsAllLocked({ add: "locked", edit: "locked", remove: "locked" })).toBe(true);
  });
  it("finds pending requests and allowed kinds", () => {
    expect(pendingFor([{ id: "1", field: "title" }], "title")?.id).toBe("1");
    expect(pendingFor(undefined, "title")).toBeNull();
    expect(isKindAllowed("Website", null)).toBe(true);
    expect(isKindAllowed("Instagram", ["Website"])).toBe(false);
  });
});

describe("links and domains", () => {
  it("reads the domain of links, emails and bare domains", () => {
    expect(domainOf("https://www.Bad.com/x?y=1")).toBe("bad.com");
    expect(domainOf("bad.com")).toBe("bad.com");
    expect(domainOf("mailto:bob@bad.com")).toBe("bad.com");
    expect(domainOf("bob@bad.com")).toBe("bad.com");
    expect(domainOf("https://shop.bad.com:8080/")).toBe("shop.bad.com");
    expect(domainOf("")).toBe("");
  });
  it("matches banned domains and their subdomains only", () => {
    expect(bannedHit("https://bad.com/a", ["bad.com"])).toBe("bad.com");
    expect(bannedHit("https://shop.bad.com", ["bad.com"])).toBe("bad.com");
    expect(bannedHit("https://notbad.com", ["bad.com"])).toBeNull();
    expect(bannedHit("https://good.org/bad.com", ["bad.com"])).toBeNull();
    expect(bannedHit("x", undefined)).toBeNull();
  });
  it("reads the banned list from text", () => {
    expect(parseDomains("bad.com\nhttps://www.evil.org/page, bad.com").domains).toEqual(["bad.com", "evil.org"]);
    expect(parseDomains("not a domain, ok.com").bad).toEqual(["not a domain"]);
    expect(parseDomains("").domains).toEqual([]);
  });
});

describe("rules matrix", () => {
  const rules: FieldRules = {
    name: "free", title: "free", photo: "free", company: "free", address: "free", slug: "free", features: "free", vcard: "free", button_add: "free", button_edit: "free", button_remove: "free",
    allowed_kinds: null, banned_domains: [], mandatory_buttons: [],
  };
  it("sends only what changed", () => {
    const draft: FieldRules = { ...rules, title: "locked", banned_domains: ["bad.com"] };
    expect(ruleChanges(rules, draft)).toEqual({ title: "locked", banned_domains: ["bad.com"] });
    expect(ruleChanges(rules, rules)).toEqual({});
  });
  it("summarises the rules in words", () => {
    expect(rulesSummary(rules)).toBe("Employees can change everything on their card.");
    const r: FieldRules = { ...rules, name: "locked", title: "approval", mandatory_buttons: [{ kind: "Website", value: "a.com", label: "" }], banned_domains: ["a.com", "b.com"] };
    expect(rulesSummary(r)).toBe("1 locked, 1 need approval, 1 required button, 2 banned domains");
  });
  it("adds a mandatory button once", () => {
    const b = { kind: "Website", value: "https://a.com/", label: "A" } as const;
    expect(addMandatory([], b)).toHaveLength(1);
    expect(addMandatory([b], { ...b, value: "https://A.com" })).toHaveLength(1);
    expect(addMandatory([b], { kind: "Mobile", value: "+974", label: "" })).toHaveLength(2);
  });
});

describe("change requests", () => {
  it("diffs button lists, ignoring switched off and empty ones", () => {
    const oldL = [{ kind: "Mobile", value: "+974111" }, { kind: "Email", value: "a@x.com", on: false }, { kind: "Website", value: "" }];
    const newL = [{ kind: "Mobile", value: "+974111" }, { kind: "Instagram", value: "bob" }, { kind: "Email", value: "a@x.com" }];
    const d = diffButtons(oldL, newL);
    expect(d.added.map((x) => x.kind)).toEqual(["Instagram", "Email"]);
    expect(d.removed).toEqual([]);
    expect(diffButtons(newL, [newL[0]]).removed.map((x) => x.kind)).toEqual(["Instagram", "Email"]);
    expect(diffButtons(null, undefined)).toEqual({ added: [], removed: [] });
  });
  it("sums a request up in one line", () => {
    expect(changeSummary({ field: "title", old: "Rep", new: "Head" })).toBe('Job title: “Rep” to “Head”');
    expect(changeSummary({ field: "name", old: "", new: "Bo" })).toBe('Name: empty to “Bo”');
    expect(changeSummary({ field: "photo", old: null, new: null })).toBe("New photo");
    expect(changeSummary({ field: "buttons", old: [], new: [{ kind: "Mobile", value: "1" }] })).toBe("Buttons: add 1");
  });
  it("marks removed and added words", () => {
    const parts = textDiff("Senior Account Rep", "Head of Sales");
    expect(parts.map((p) => p.kind)).toContain("del");
    expect(parts.map((p) => p.kind)).toContain("add");
    expect(textDiff("same text", "same text")).toEqual([{ kind: "same", text: "same text" }]);
    const small = textDiff("Rep", "Senior Rep");
    expect(small.find((p) => p.kind === "add")?.text.trim()).toBe("Senior");
    expect(small.find((p) => p.kind === "same")?.text).toBe("Rep");
  });
});

describe("audit page logic", () => {
  it("builds the query from filters and drops empty ones", () => {
    expect(queryOf({ ...EMPTY_FILTERS, action: "card.", q: " bob " }, 2)).toEqual({
      actor: undefined, action: "card.", from: undefined, to: undefined, q: "bob", page: 2, page_size: 50,
    });
    expect(hasFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasFilters({ ...EMPTY_FILTERS, from: "2026-01-01" })).toBe(true);
  });
  it("checks the date range", () => {
    expect(rangeProblem({ from: "2026-02-01", to: "2026-01-01" })).toContain("after");
    expect(rangeProblem({ from: "2026-01-01", to: "2026-01-01" })).toBeNull();
    expect(rangeProblem({ from: "", to: "2026-01-01" })).toBeNull();
  });
  it("gives last-N-days ranges including today", () => {
    expect(lastDays(7, new Date("2026-03-10T12:00:00Z"))).toEqual({ from: "2026-03-04", to: "2026-03-10" });
    expect(lastDays(1, new Date("2026-03-10T12:00:00Z"))).toEqual({ from: "2026-03-10", to: "2026-03-10" });
  });
  it("writes entries as sentences", () => {
    const e = (action: string, target_label: string, details: Record<string, unknown> = {}) => describeEvent({ action, target_label, details, label: "Label" });
    expect(e("member.role_changed", "Bob", { from: "employee", to: "admin" })).toBe("Changed Bob from Team member to Admin");
    expect(e("card.reassigned", "Bob", { to: null })).toBe("Handed the card of Bob to nobody (shared card)");
    expect(e("card.reassigned", "Bob", { to: { email: "c@x.com" } })).toBe("Handed the card of Bob to c@x.com");
    expect(e("member.removed", "Bob", { card_policy: "delete" })).toBe("Removed Bob (card: deleted)");
    expect(e("bulk.run", "", { action: "publish", ok: 3, failed: 1 })).toBe("Bulk publish: 3 done, 1 refused");
    expect(e("brand.lock_changed", "", { lock_design: true, lock_allows_departments: true })).toBe("Locked the company design (departments may differ)");
    expect(e("directory.updated", "", { enabled: true, slug: "acme" })).toBe("Switched the directory on at /d/acme");
    expect(e("something.new", "", {})).toBe("Label");
  });
  it("names the person or the system", () => {
    expect(actorName({ actor: null })).toBe("System");
    expect(actorName({ actor: { id: "1", full_name: "", email: "a@x.com" } })).toBe("a@x.com");
  });
});

describe("departments", () => {
  const depts = [{ id: "1", name: "Sales" }, { id: "2", name: "Support" }];
  it("checks names without case, allowing the one being edited", () => {
    expect(nameProblem("", depts)).toContain("Enter");
    expect(nameProblem("sales", depts)).toContain("already");
    expect(nameProblem("sales", depts, "1")).toBeNull();
    expect(nameProblem("x".repeat(61), depts)).toContain("60");
    expect(nameProblem("Legal", depts)).toBeNull();
  });
  it("summarises a template", () => {
    const d = { design: {}, items: [], mandatory_items: [] } as Pick<Department, "design" | "items" | "mandatory_items">;
    expect(templateSummary(d)).toBe("Company design");
    const b = { kind: "Website", value: "a.com", label: "" } as const;
    expect(templateSummary({ design: { face: 3 }, items: [b], mandatory_items: [b, b] })).toBe("Own design, 1 starting button, 2 required");
  });
  it("fills missing design keys from the company design", () => {
    expect(fullDesign({ face: 9 }, { face: 1, colour: 2, below: 3, intro: 4 })).toEqual({ face: 9, colour: 2, below: 3, intro: 4, font: "face", size: 100 });
    expect(fullDesign({ size: 120 }, { face: 1, colour: 2, below: 3, intro: 4, font: "lora", size: 90 })).toEqual({ face: 1, colour: 2, below: 3, intro: 4, font: "lora", size: 120 });
  });
  it("compares buttons by kind and value", () => {
    expect(sameButton({ kind: "Website", value: "https://a.com/" }, { kind: "Website", value: "HTTPS://A.COM" })).toBe(true);
    expect(sameButton({ kind: "Website", value: "a.com" }, { kind: "Custom", value: "a.com" })).toBe(false);
    expect(buttonsProblem([{ kind: "Mobile", value: "1" }, { kind: "Email", value: " " }])).toContain("Button 2");
    expect(buttonsProblem([])).toBeNull();
  });
  it("counts and filters members by department", () => {
    const ms = [{ department_id: "1" }, { department_id: "1" }, { department_id: null }, {}];
    expect(countByDepartment(ms)).toEqual({ "1": 2, "": 2 });
    expect(matchesDepartment(ms[0], "all")).toBe(true);
    expect(matchesDepartment(ms[2], "none")).toBe(true);
    expect(matchesDepartment(ms[3], "none")).toBe(true);
    expect(matchesDepartment(ms[0], "1")).toBe(true);
    expect(matchesDepartment(ms[0], "2")).toBe(false);
  });
});

describe("directory", () => {
  it("checks the address like the API does", () => {
    expect(directorySlugProblem("")).toContain("Choose");
    expect(directorySlugProblem("ab")).toContain("3 to 40");
    expect(directorySlugProblem("-no")).toContain("3 to 40");
    expect(directorySlugProblem("app")).toContain("reserved");
    expect(directorySlugProblem("Acme People")).toBeNull();
    expect(normaliseDirectorySlug(" Acme_People ")).toBe("acme-people");
  });
  it("builds links and query strings", () => {
    expect(directoryUrl("https://bench.example/", "acme")).toBe("https://bench.example/d/acme");
    expect(directoryQuery({})).toBe("");
    expect(directoryQuery({ q: " sam ", department: "d1", page: 3 })).toBe("?q=sam&department=d1&page=3");
    expect(directoryQuery({ page: 1 })).toBe("");
  });
  it("reads a safe page number", () => {
    expect(parsePage("3")).toBe(3);
    expect(parsePage(["2", "9"])).toBe(2);
    expect(parsePage("-1")).toBe(1);
    expect(parsePage("abc")).toBe(1);
    expect(parsePage(undefined)).toBe(1);
    expect(parsePage("1.5")).toBe(1);
  });
  it("writes page text without a hard-coded product name", () => {
    const m = directoryMeta("Acme Ltd", 12);
    expect(m.title).toBe("Acme Ltd team directory");
    expect(m.description).toContain("12 people at Acme Ltd");
    expect(directoryMeta("Acme", 1).description).toContain("1 person at");
    expect(resultsLine(3, 12, true)).toBe("3 people match your search");
    expect(resultsLine(1, 12, true)).toBe("1 person matches your search");
    expect(resultsLine(12, 12, false)).toBe("12 people");
  });
});

describe("button editor guards", () => {
  const must = [{ kind: "Website" as const, value: "https://acme.example", label: "Acme" }];
  it("refuses removing, switching off or changing a required button", () => {
    const prev = [{ kind: "Website", value: "https://acme.example", on: true }, { kind: "Mobile", value: "+974", on: true }];
    expect(mandatoryProblem(prev, prev, must)).toBeNull();
    expect(mandatoryProblem([prev[1]], prev, must)).toContain("required by your company");
    expect(mandatoryProblem([{ ...prev[0], on: false }, prev[1]], prev, must)).toContain("Acme button");
    expect(mandatoryProblem([{ ...prev[0], value: "https://other.example" }, prev[1]], prev, must)).not.toBeNull();
    expect(mandatoryProblem([{ ...prev[0], value: "HTTPS://ACME.EXAMPLE/" }], prev, must)).toBeNull();
    // A card that never had it is not blamed for the missing button.
    expect(mandatoryProblem([prev[1]], [prev[1]], must)).toBeNull();
  });
  it("flags kinds that are not allowed and banned links, ignoring hidden ones", () => {
    const access = { allowed_kinds: ["Website", "Mobile"] as ItemKind[], banned_domains: ["bad.com"] };
    expect(linkProblem([{ kind: "Website", value: "good.org" }], access)).toBeNull();
    expect(linkProblem([{ kind: "Instagram", value: "bob" }], access)).toContain("does not allow Instagram");
    expect(linkProblem([{ kind: "Website", value: "https://shop.bad.com" }], access)).toContain("bad.com");
    expect(linkProblem([{ kind: "Instagram", value: "bob", on: false }, { kind: "Website", value: "" }], access)).toBeNull();
    expect(linkProblem([{ kind: "Instagram", value: "bob" }], { allowed_kinds: null, banned_domains: [] })).toBeNull();
  });
  it("knows which items are required", () => {
    expect(isRequired({ kind: "Website", value: "https://acme.example/" }, must)).toBe(true);
    expect(isRequired({ kind: "Website", value: "https://acme.example", on: false }, must)).toBe(false);
    expect(isRequired({ kind: "Mobile", value: "x" }, must)).toBe(false);
  });
});
