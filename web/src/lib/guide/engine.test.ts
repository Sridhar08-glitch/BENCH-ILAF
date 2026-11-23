import { describe, expect, it } from "vitest";
import {
  allDoneSuggestions, audienceFor, chosenAudience, evaluate, flagsOf, guideView, inferAudience, mergeProgress, mergeServerAndLocal,
  needsQuestion, needsWelcome, newlyDone, promptDue, resolveRoute, stateOf, stepHref, viewFor, whatNext,
} from "./engine";
import { emptyContext } from "./context";
import { GUIDES } from "./guides";
import { FOLLOW_UPS, PROMPTS, SUGGESTIONS, promptFor } from "./whatnext";
import { AUDIENCES, type GuideContext, type ProgressItem } from "./types";

const ctx = (over: Partial<GuideContext> = {}): GuideContext => ({ ...emptyContext(), card_id: "c1", ...over });
const row = (guide_id: string, step_id: string, state: ProgressItem["state"], updated = "2026-01-01T00:00:00Z"): ProgressItem => ({ guide_id, step_id, state, updated });

describe("conditions", () => {
  it("reads flags, numbers and combinations", () => {
    const c = ctx({ has_name: true, items_count: 3 });
    expect(evaluate({ is: "has_name" }, c)).toBe(true);
    expect(evaluate({ is: "has_photo" }, c)).toBe(false);
    expect(evaluate({ gte: ["items_count", 3] }, c)).toBe(true);
    expect(evaluate({ gte: ["items_count", 4] }, c)).toBe(false);
    expect(evaluate({ gte: ["has_name", 1] }, c)).toBe(false);
    expect(evaluate({ all: [{ is: "has_name" }, { is: "has_photo" }] }, c)).toBe(false);
    expect(evaluate({ any: [{ is: "has_name" }, { is: "has_photo" }] }, c)).toBe(true);
    expect(evaluate({ not: { is: "has_photo" } }, c)).toBe(true);
  });
});

describe("routes", () => {
  it("fills in the card and falls back to the list", () => {
    expect(resolveRoute("/app/cards/{card}", { card_id: "a b" })).toBe("/app/cards/a%20b");
    expect(resolveRoute("/app/cards/{card}", { card_id: null })).toBe("/app/cards");
    expect(resolveRoute("/app/team", { card_id: null })).toBe("/app/team");
  });

  it("adds the highlight query", () => {
    const step = GUIDES.personal.steps[0];
    expect(stepHref(step, { card_id: "c1" })).toBe("/app/cards/c1?guide=profile");
    expect(stepHref({ ...step, route: "/app/x?a=1" }, { card_id: null })).toBe("/app/x?a=1&guide=profile");
  });
});

describe("the guides", () => {
  it("every guide has steps with unique ids, and every audience has a guide", () => {
    for (const a of AUDIENCES) {
      const g = GUIDES[a];
      expect(g.id).toBe(a);
      const ids = g.steps.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.length).toBeGreaterThanOrEqual(5);
    }
  });

  it("personal: steps follow the card", () => {
    const empty = viewFor("personal", ctx(), []);
    expect(empty.finished).toBe(0);
    expect(empty.next?.step.id).toBe("profile");
    const v = viewFor("personal", ctx({ has_name: true, has_photo: true, items_count: 2, design_changed: true, card_published: true }), []);
    expect(v.steps.map((s) => s.status)).toEqual(["done", "done", "done", "done", "todo"]);
    expect(v.percent).toBe(80);
    expect(v.complete).toBe(false);
    const all = viewFor("personal", ctx({ has_name: true, has_photo: true, items_count: 2, design_changed: true, card_published: true, shared_qr_opened: true }), []);
    expect(all.complete).toBe(true);
    expect(all.percent).toBe(100);
    expect(all.next).toBeNull();
  });

  it("company owner: brand, style, lock, invite, departments, publish; directory is optional", () => {
    const g = GUIDES.company_owner;
    expect(g.steps.map((s) => s.id)).toEqual(["brand", "card-style", "lock", "invite", "departments", "publish-cards", "directory"]);
    const done = ctx({ brand_logo_set: true, brand_colours_set: true, brand_style_set: true, lock_enabled: true, invites_sent: 2, departments_count: 1, published_count: 1 });
    const v = guideView(g, done, []);
    expect(v.complete).toBe(true);
    expect(v.steps.find((s) => s.step.id === "directory")?.status).toBe("todo");
    expect(v.total).toBe(6);
    // a half-done brand does not tick the brand step
    expect(guideView(g, ctx({ brand_logo_set: true }), []).steps[0].status).toBe("todo");
  });

  it("company admin has no directory step", () => {
    expect(GUIDES.company_admin.steps.some((s) => s.id === "directory")).toBe(false);
  });

  it("employee: the approval step only appears where approval rules exist", () => {
    const without = viewFor("employee", ctx({ invite_accepted: true }), []);
    expect(without.steps.map((s) => s.step.id)).toEqual(["accept-invite", "fill-details", "publish", "share"]);
    expect(without.steps[0].status).toBe("done");
    const withRules = viewFor("employee", ctx({ invite_accepted: true, approval_rules: true }), []);
    expect(withRules.steps.map((s) => s.step.id)).toContain("send-approval");
  });

  it("a step is done by hand, skipped by hand, and a hand-made mark can be undone", () => {
    const p = [row("personal", "design", "done"), row("personal", "buttons", "skipped")];
    const v = viewFor("personal", ctx(), p);
    expect(v.steps.find((s) => s.step.id === "design")?.status).toBe("done");
    expect(v.steps.find((s) => s.step.id === "design")?.auto).toBe(false);
    expect(v.steps.find((s) => s.step.id === "buttons")?.status).toBe("skipped");
    expect(v.finished).toBe(2);
    expect(viewFor("personal", ctx(), mergeProgress(p, { guide_id: "personal", step_id: "design", state: "reset" })).finished).toBe(1);
  });

  it("data wins over a skip", () => {
    const v = viewFor("personal", ctx({ card_published: true }), [row("personal", "publish", "skipped")]);
    expect(v.steps.find((s) => s.step.id === "publish")?.status).toBe("done");
  });
});

describe("progress merge", () => {
  it("replaces a row for the same step and removes on reset", () => {
    let list: ProgressItem[] = [];
    list = mergeProgress(list, { guide_id: "g", step_id: "a", state: "done" });
    list = mergeProgress(list, { guide_id: "g", step_id: "a", state: "skipped" });
    expect(list).toHaveLength(1);
    expect(stateOf(list, "g", "a")).toBe("skipped");
    list = mergeProgress(list, { guide_id: "g", step_id: "a", state: "reset" });
    expect(list).toHaveLength(0);
  });

  it("the later change wins between the server and this device", () => {
    const server = [row("g", "a", "done", "2026-01-02T00:00:00Z"), row("g", "b", "done", "2026-01-01T00:00:00Z")];
    const local = [row("g", "a", "skipped", "2026-01-01T00:00:00Z"), row("g", "b", "skipped", "2026-01-03T00:00:00Z"), row("g", "c", "done", "2026-01-03T00:00:00Z")];
    const merged = mergeServerAndLocal(server, local);
    expect(stateOf(merged, "g", "a")).toBe("done");
    expect(stateOf(merged, "g", "b")).toBe("skipped");
    expect(stateOf(merged, "g", "c")).toBe("done");
  });

  it("reads client flags", () => {
    expect(flagsOf([row("flag", "shared_qr_opened", "done"), row("flag", "x", "dismissed"), row("g", "y", "done")])).toEqual({ shared_qr_opened: true });
  });
});

describe("audience", () => {
  it("is obvious from the role in a company", () => {
    expect(inferAudience({ kind: "company", role: "owner" })).toBe("company_owner");
    expect(inferAudience({ kind: "company", role: "admin" })).toBe("company_admin");
    expect(inferAudience({ kind: "company", role: "employee" })).toBe("employee");
    expect(inferAudience({ kind: "personal", role: "owner" })).toBeNull();
    expect(needsQuestion({ kind: "company", role: "employee" })).toBe(false);
    expect(needsQuestion({ kind: "personal", role: "owner" })).toBe(true);
  });

  it("uses the choice for a personal workspace, never the employee path without a company", () => {
    const personal = { kind: "personal" as const, role: "owner" as const };
    expect(audienceFor(personal, [])).toBe("personal");
    expect(audienceFor(personal, [row("welcome", "audience-company_owner", "done")])).toBe("company_owner");
    expect(audienceFor(personal, [row("welcome", "audience-employee", "done")])).toBe("personal");
    expect(chosenAudience([row("welcome", "audience-personal", "done")])).toBe("personal");
    expect(audienceFor({ kind: "company", role: "employee" }, [row("welcome", "audience-personal", "done")])).toBe("employee");
  });

  it("the welcome shows until it has been seen", () => {
    const f = { kind: "personal" as const, role: "owner" as const };
    expect(needsWelcome(f, [])).toBe(true);
    expect(needsWelcome(f, [row("welcome", "seen", "dismissed")])).toBe(false);
  });
});

describe("what next", () => {
  it("after publishing suggests the QR code and the signature, then stops at two", () => {
    const c = ctx({ card_published: true });
    const v = viewFor("personal", c, []);
    const out = whatNext(v, "publish", c);
    expect(out.map((o) => o.id)).toEqual(["qr", "signature"]);
  });

  it("skips suggestions that are already done", () => {
    const c = ctx({ card_published: true, shared_qr_opened: true });
    const v = viewFor("personal", c, []);
    const out = whatNext(v, "publish", c);
    expect(out[0].id).toBe("signature");
  });

  it("falls back to the next unfinished step", () => {
    const c = ctx({ has_name: true, has_photo: true });
    const v = viewFor("personal", c, []);
    const out = whatNext(v, "profile", c);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("buttons");
    expect(out[0].route).toBe("/app/cards/c1?guide=buttons");
  });

  it("inviting a team is only suggested to a company manager", () => {
    const personal = allDoneSuggestions(ctx());
    expect(personal.map((s) => s.id)).toEqual(["qr", "signature", "background"]);
    const owner = allDoneSuggestions(ctx({ is_company: true, is_manager: true }));
    expect(owner.map((s) => s.id)).toEqual(["qr", "signature", "background", "team"]);
    const invited = allDoneSuggestions(ctx({ is_company: true, is_manager: true, invites_sent: 3 }));
    expect(invited.map((s) => s.id)).toEqual(["qr", "signature", "background"]);
  });

  it("every follow-up points at a known suggestion and every step has an entry", () => {
    for (const ids of Object.values(FOLLOW_UPS)) for (const id of ids) expect(SUGGESTIONS[id]).toBeDefined();
    for (const g of Object.values(GUIDES)) for (const s of g.steps) expect(FOLLOW_UPS[s.id], s.id).toBeDefined();
  });

  it("notices which steps just finished", () => {
    const before = viewFor("personal", ctx(), []);
    const after = viewFor("personal", ctx({ card_published: true }), []);
    expect(newlyDone(before, after)).toEqual(["publish"]);
    expect(newlyDone(null, after)).toEqual([]);
  });
});

describe("prompts", () => {
  it("each key event has a prompt and is shown once", () => {
    expect(PROMPTS.map((p) => p.event)).toEqual(["card_published", "first_invite_sent", "brand_saved", "first_lead", "export_done"]);
    expect(promptFor("card_published")?.route).toBe("/app/qr");
    expect(promptFor("nope")).toBeNull();
    expect(promptDue([], "card_published")).toBe(true);
    expect(promptDue([row("next", "card_published", "shown")], "card_published")).toBe(false);
    expect(promptDue([row("next", "card_published", "shown")], "brand_saved")).toBe(true);
  });
});
