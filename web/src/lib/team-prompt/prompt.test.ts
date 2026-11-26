import { describe, expect, it } from "vitest";
import type { Plan } from "@/lib/types";
import { SNOOZE_DAYS, emailDomain, isPublicEmailDomain, minCompanySeats, promptCards, readSnooze, shouldShowTeamPrompt, snoozeEnd, suggestedCompanyName, writeSnooze, type PromptInput } from "./prompt";

const NOW = Date.UTC(2026, 10, 26);
const base: PromptInput = {
  workspaceKind: "personal", hasCompany: false, email: "sara@northgate.com",
  cards: [{ status: "published", company: "Northgate", leads: 0 }], snoozedUntil: null, now: NOW,
};

describe("public mail providers", () => {
  it("recognises common and local providers, including country endings", () => {
    for (const e of ["a@gmail.com", "a@GMAIL.com", "a@outlook.com", "a@hotmail.com", "a@hotmail.co.uk", "a@yahoo.com", "a@yahoo.co.jp", "a@icloud.com", "a@proton.me", "a@protonmail.com", "a@live.com", "a@qq.com", "a@mail.ru", "a@gmx.de", "a@maktoob.com", "a"]) {
      expect(isPublicEmailDomain(e), e).toBe(true);
    }
  });
  it("a company address is not public, even when a provider name is only part of it", () => {
    for (const e of ["a@northgate.com", "a@live.northgate.com", "a@gmail.northgate.co", "a@acme.co.uk", "a@mailers.com"]) expect(isPublicEmailDomain(e), e).toBe(false);
    expect(emailDomain("x@Y.com")).toBe("y.com");
    expect(emailDomain("nothing")).toBe("");
  });
});

describe("when the team prompt shows", () => {
  it("shows for a personal workspace with a company-looking address and a published card with a company name", () => {
    expect(shouldShowTeamPrompt(base)).toBe(true);
  });
  it("shows for a published card with at least one contact, even without a company name", () => {
    expect(shouldShowTeamPrompt({ ...base, cards: [{ status: "published", company: "", leads: 1 }] })).toBe(true);
    expect(shouldShowTeamPrompt({ ...base, cards: [{ status: "published", company: "", leads: 0 }] })).toBe(false);
    expect(shouldShowTeamPrompt({ ...base, cards: [{ status: "published", company: "", hasLogo: true, leads: null }] })).toBe(true);
  });
  it("never for company members or company workspaces", () => {
    expect(shouldShowTeamPrompt({ ...base, workspaceKind: "company" })).toBe(false);
    expect(shouldShowTeamPrompt({ ...base, hasCompany: true })).toBe(false);
  });
  it("not for public providers", () => {
    expect(shouldShowTeamPrompt({ ...base, email: "sara@gmail.com" })).toBe(false);
  });
  it("not before the card is published", () => {
    expect(shouldShowTeamPrompt({ ...base, cards: [{ status: "draft", company: "Northgate", leads: 3 }] })).toBe(false);
    expect(shouldShowTeamPrompt({ ...base, cards: [] })).toBe(false);
  });
  it("a dismissal hides it for 30 days", () => {
    const until = snoozeEnd(NOW);
    expect(until - NOW).toBe(SNOOZE_DAYS * 24 * 60 * 60 * 1000);
    expect(shouldShowTeamPrompt({ ...base, snoozedUntil: until })).toBe(false);
    expect(shouldShowTeamPrompt({ ...base, snoozedUntil: until, now: until - 1 })).toBe(false);
    expect(shouldShowTeamPrompt({ ...base, snoozedUntil: until, now: until })).toBe(true);
  });
  it("suggests the company name of the first matching card", () => {
    const cards = [{ status: "draft", company: "Draft Co", leads: 0 }, { status: "published", company: "  Northgate ", leads: 0 }];
    expect(promptCards(cards)).toHaveLength(1);
    expect(suggestedCompanyName(cards)).toBe("Northgate");
    expect(suggestedCompanyName([{ status: "published", company: "", leads: 2 }])).toBe("");
  });
});

describe("the snooze is stored and read safely", () => {
  it("round-trips and ignores bad values and blocked storage", () => {
    const data = new Map<string, string>();
    const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    expect(readSnooze(store)).toBeNull();
    writeSnooze(NOW, store);
    expect(readSnooze(store)).toBe(snoozeEnd(NOW));
    data.set("bench.teamPromptSnoozeUntil", "garbage");
    expect(readSnooze(store)).toBeNull();
    expect(readSnooze(null)).toBeNull();
    const blocked = {
      getItem: () => {
        throw new Error("no");
      },
      setItem: () => {
        throw new Error("no");
      },
    };
    expect(readSnooze(blocked)).toBeNull();
    expect(() => writeSnooze(NOW, blocked)).not.toThrow();
  });
});

describe("the seats a company plan starts at", () => {
  const plan = (o: Partial<Plan>): Plan => ({ code: "x", name: "x", kind: "company", interval: "year", price_minor: 1, currency: "USD", max_cards: 0, per_seat: true, min_seats: 5, features: [], ...o });
  it("takes the smallest purchasable company plan", () => {
    expect(minCompanySeats([plan({ min_seats: 10 }), plan({ min_seats: 5 }), plan({ min_seats: 2, by_quote: true }), plan({ min_seats: 1, kind: "personal" }), plan({ min_seats: 1, purchasable: false })])).toBe(5);
  });
  it("is null when there is nothing to quote", () => {
    expect(minCompanySeats(undefined)).toBeNull();
    expect(minCompanySeats([plan({ kind: "personal" })])).toBeNull();
  });
});
