import { describe, expect, it } from "vitest";
import { createI18n } from "@/lib/i18n";
import { CATALOGUES } from "@/lib/i18n/messages";
import type { CardSection } from "@/lib/api-content";
import type { Plan, Subscription } from "@/lib/types";
import { FREE_LIMIT, isFreePlan, kindName, movedSections, richPagesAllowed } from "./ContentTab";
import { fromLocalInput, toLocalInput } from "./content/EventForm";
import { pickableCards } from "./content/TeamForm";
import { timeZones } from "./content/HoursForm";

const sub = (o: Partial<Subscription> = {}): Subscription => ({ status: "active", plan_code: "business", seats_total: 1, seats_used: 1, starts_at: null, ends_at: null, grace_ends_at: null, live: true, ...o });
const plan = (code: string, price_minor: number): Plan => ({ code, name: code, kind: "personal", interval: "year", price_minor, currency: "QAR", max_cards: 1, per_seat: false, min_seats: 1, features: [] });

describe("plan lock", () => {
  it("allows rich pages on a live paid plan only, and while the answer is unknown", () => {
    const plans = [plan("free", 0), plan("business", 9900)];
    expect(richPagesAllowed(sub(), plans)).toBe(true);
    expect(richPagesAllowed(sub({ plan_code: "free" }), plans)).toBe(false);
    expect(richPagesAllowed(sub({ live: false, status: "expired" }), plans)).toBe(false);
    expect(richPagesAllowed(sub({ plan_code: "unknown" }), plans)).toBe(true);
    expect(richPagesAllowed(undefined, plans)).toBe(true);
    expect(richPagesAllowed(sub(), undefined)).toBe(true);
  });
});

describe("section rows", () => {
  const rows = [
    { id: "a", kind: "video", order: 0, on: true, data: { title: "" } },
    { id: "b", kind: "map", order: 1, on: true, data: { title: "", address: "", maps_url: "", directions_note: "" } },
    { id: "c", kind: "hours", order: 2, on: false, data: { title: "", timezone: "UTC", days: [], note: "" } },
  ] as CardSection[];

  it("moves a row a step and renumbers", () => {
    expect(movedSections(rows, "c", -1).map((s) => `${s.id}${s.order}`)).toEqual(["a0", "c1", "b2"]);
    expect(movedSections(rows, "a", -1).map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(movedSections(rows, "c", 1).map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(movedSections(rows, "nope", 1)).toHaveLength(3);
  });

  it("names kinds in both languages", () => {
    const en = createI18n("en", "latn", CATALOGUES.en).t;
    const ar = createI18n("ar", "latn", CATALOGUES.ar).t;
    expect(kindName("hours", en)).toBe("Opening hours");
    expect(kindName("hours", ar)).toBe("ساعات العمل");
  });
});

describe("event form dates", () => {
  it("round-trips an ISO date through the local field", () => {
    const iso = "2026-12-01T09:00:00.000Z";
    const local = toLocalInput(iso);
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(fromLocalInput(local)).toBe(iso);
    expect(toLocalInput("")).toBe("");
    expect(toLocalInput("not a date")).toBe("");
    expect(fromLocalInput("")).toBe("");
    expect(fromLocalInput("nope")).toBe("");
  });
});

describe("team picks", () => {
  it("offers published, visible cards of the workspace other than this card", () => {
    const base = { workspace_id: "w", owner: null, public_url: "", slug: null, name: "", title: "", company: "", address: "", photo_url: null, save_contact: true, vc: { company: true, photo: true, phones: true, emails: true, urls: true, social: true, addr: true, note: "" }, design: { top: 0, face: 1, colour: 0, below: 1, intro: 0, font: "face", size: 100, photo: true, brand_colors: false, foot: true }, items: [], created_at: "", updated_at: "", stats: { views: 0, scans: 0, saves: 0, leads: 0 } };
    const cards = [
      { ...base, id: "me", public_code: "me", status: "published" as const },
      { ...base, id: "k", public_code: "k", status: "published" as const },
      { ...base, id: "d", public_code: "d", status: "draft" as const },
      { ...base, id: "h", public_code: "h", status: "published" as const, hide_from_directory: true },
    ];
    expect(pickableCards(cards, "me").map((c) => c.id)).toEqual(["k"]);
    expect(pickableCards(undefined, "me")).toEqual([]);
  });

  it("lists time zones", () => {
    const zones = timeZones();
    expect(zones).toContain("Asia/Qatar");
    expect(zones.length).toBeGreaterThan(10);
  });
});

describe("the free plan", () => {
  const sub = (plan_code: string | null) => ({ status: "active", plan_code, seats_total: 1, seats_used: 1, starts_at: null, ends_at: null, grace_ends_at: null, live: true }) as never;
  it("is a personal workspace with no plan yet or on the free trial", () => {
    expect(isFreePlan("personal", sub(null))).toBe(true);
    expect(isFreePlan("personal", sub("free"))).toBe(true);
    expect(isFreePlan("personal", sub("personal"))).toBe(false);
    expect(isFreePlan("company", sub(null))).toBe(false);
    expect(isFreePlan("personal", undefined)).toBe(false);
    expect(FREE_LIMIT).toBe(50);
  });
});
