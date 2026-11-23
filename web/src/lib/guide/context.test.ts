import { describe, expect, it } from "vitest";
import { buildContext, emptyContext, hasApprovalRules, myCard } from "./context";
import type { Brand, Card, FieldRules, Member } from "@/lib/types";

const card = (over: Partial<Card> = {}): Card => ({
  id: "c1", owner: { id: "u1", full_name: "A", email: "a@x.com" }, status: "draft", name: "Alice", title: "", photo_url: null,
  design: { face: 1, colour: 0, below: 1, intro: 1 },
  items: [],
  ...over,
} as unknown as Card);

const member = (over: Partial<Member>): Member => ({ id: "m", user: null, email: "e@x.com", role: "employee", status: "invited", ...over } as unknown as Member);

describe("buildContext", () => {
  it("is empty and safe while nothing has loaded", () => {
    const c = buildContext({ userId: "u1", kind: "personal", role: "owner" });
    expect(c).toEqual({ ...emptyContext(), is_manager: true });
  });

  it("reads the person's own card", () => {
    const mine = card({
      status: "published", title: "Designer", photo_url: "/p.png",
      design: { face: 7, colour: 0, below: 1, intro: 1 } as Card["design"],
      items: [
        { kind: "Mobile", value: "+974", label: "", on: true },
        { kind: "Email", value: "a@x.com", label: "", on: true },
        { kind: "Website", value: "", label: "", on: true },
        { kind: "Facebook", value: "fb", label: "", on: false },
      ],
    });
    const other = card({ id: "c2", owner: { id: "u2", full_name: "B", email: "b@x.com" }, status: "published" });
    const c = buildContext({ userId: "u1", kind: "personal", role: "owner", cards: [other, mine] });
    expect(c.card_id).toBe("c1");
    expect(c.cards_count).toBe(2);
    expect(c.published_count).toBe(2);
    expect(c.has_name && c.has_title && c.has_photo).toBe(true);
    expect(c.items_count).toBe(2);
    expect(c.design_changed).toBe(true);
    expect(c.card_published).toBe(true);
  });

  it("an untouched design is not a choice", () => {
    expect(buildContext({ userId: "u1", kind: "personal", role: "owner", cards: [card()] }).design_changed).toBe(false);
  });

  it("falls back to the first card when the person owns none", () => {
    expect(myCard([card({ id: "x", owner: null })], "u1")?.id).toBe("x");
    expect(myCard([], "u1")).toBeNull();
    expect(myCard(null, "u1")).toBeNull();
  });

  it("reads the company brand, the team, departments and leads", () => {
    const brand = {
      logo_url: "/logo.png", colours: { primary: "#112233", accent: "#ff6b35", mode: "brand" }, lock_design: true, directory_enabled: true,
      design: { face: 3, colour: 4, below: 1, intro: 1 },
    } as unknown as Brand;
    const members = [
      member({ id: "1", user: { id: "u1", full_name: "Me", email: "me@x.com", photo_url: null }, role: "owner", status: "active" }),
      member({ id: "2", status: "invited" }),
      member({ id: "3", status: "active", user: { id: "u3", full_name: "C", email: "c@x.com", photo_url: null } }),
    ];
    const c = buildContext({
      userId: "u1", kind: "company", role: "owner", brand, members, leadsCount: 4, departmentsCount: 2, webhooksCount: 1,
      progress: [{ guide_id: "flag", step_id: "shared_qr_opened", state: "done" }, { guide_id: "flag", step_id: "approval_sent", state: "dismissed" }],
    });
    expect(c.is_company && c.is_manager).toBe(true);
    expect(c.brand_logo_set && c.brand_colours_set && c.brand_style_set && c.lock_enabled && c.directory_enabled).toBe(true);
    expect(c.team_size).toBe(2);
    expect(c.invites_sent).toBe(2);
    expect(c.members_active).toBe(1);
    expect(c.departments_count).toBe(2);
    expect(c.leads_count).toBe(4);
    expect(c.webhooks_count).toBe(1);
    expect(c.shared_qr_opened).toBe(true);
    expect(c.approval_sent).toBe(false);
    expect(c.invite_accepted).toBe(false);
  });

  it("an employee in a company has accepted an invite", () => {
    expect(buildContext({ userId: "u1", kind: "company", role: "employee" }).invite_accepted).toBe(true);
    expect(buildContext({ userId: "u1", kind: "personal", role: "owner" }).invite_accepted).toBe(false);
  });

  it("finds approval rules", () => {
    const free = { name: "free", title: "free", photo: "free", company: "free", address: "free", button_add: "free", button_edit: "free", button_remove: "free" } as unknown as FieldRules;
    expect(hasApprovalRules(free)).toBe(false);
    expect(hasApprovalRules({ ...free, photo: "approval" } as unknown as FieldRules)).toBe(true);
    expect(hasApprovalRules({ ...free, title: "locked" } as unknown as FieldRules)).toBe(false);
    expect(hasApprovalRules(null)).toBe(false);
  });
});
