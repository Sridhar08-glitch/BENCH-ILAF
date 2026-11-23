import { describe, expect, it } from "vitest";
import { createI18n } from "../i18n";
import { CATALOGUES } from "../i18n/messages";
import type { Member } from "../types";
import { alreadyInTeam, cardState, filterMembers, freeSeats, parseInvites, seatProblem, statusCounts } from "./team";

const { t } = createI18n("en", "latn", CATALOGUES.en);
const mk = (over: Partial<Member>): Member => ({
  id: "1", user: null, email: "a@x.com", full_name: "", role: "employee", status: "active",
  card_id: null, invited_at: "", joined_at: null, ...over,
});

describe("parseInvites", () => {
  it("reads one email per line with optional name and title", () => {
    const r = parseInvites("Sara@Co.com\nomar@co.com, Omar Ali, Sales", "employee");
    expect(r.bad).toEqual([]);
    expect(r.invites).toEqual([
      { email: "sara@co.com", full_name: undefined, title: undefined, role: "employee" },
      { email: "omar@co.com", full_name: "Omar Ali", title: "Sales", role: "employee" },
    ]);
  });
  it("splits a comma list of emails and drops duplicates", () => {
    const r = parseInvites("a@x.com, b@x.com; a@x.com", "admin");
    expect(r.invites.map((i) => i.email)).toEqual(["a@x.com", "b@x.com"]);
    expect(r.invites[0].role).toBe("admin");
  });
  it("reports bad addresses", () => {
    expect(parseInvites("nope\nok@x.com", "employee").bad).toEqual(["nope"]);
  });
});

describe("seats", () => {
  it("counts free seats and never goes negative", () => {
    expect(freeSeats({ seats_total: 5, seats_used: 3 })).toBe(2);
    expect(freeSeats({ seats_total: 2, seats_used: 4 })).toBe(0);
  });
  it("explains the problem in plain words", () => {
    expect(seatProblem({ live: false, seats_total: 5, seats_used: 0 }, 1, t)).toMatch(/active company plan/);
    expect(seatProblem({ live: true, seats_total: 5, seats_used: 4 }, 3, t)).toMatch(/1 free seat but entered 3 people/);
    expect(seatProblem({ live: true, seats_total: 5, seats_used: 4 }, 1, t)).toBeNull();
  });
});

describe("members", () => {
  const list = [
    mk({ id: "1", email: "sara@co.com", full_name: "Sara Ahmed", status: "active", card_id: "c1" }),
    mk({ id: "2", email: "omar@co.com", status: "invited" }),
    mk({ id: "3", email: "lee@co.com", full_name: "Lee", status: "suspended", card_id: "c3" }),
  ];
  it("searches name and email and filters by status", () => {
    expect(filterMembers(list, "sara", "all").map((m) => m.id)).toEqual(["1"]);
    expect(filterMembers(list, "CO.COM", "invited").map((m) => m.id)).toEqual(["2"]);
    expect(filterMembers(list, "", "all")).toHaveLength(3);
  });
  it("counts by status", () => {
    expect(statusCounts(list)).toEqual({ all: 3, invited: 1, active: 1, suspended: 1 });
  });
  it("finds the card state", () => {
    const cards = [{ id: "c1", status: "published" as const }, { id: "c3", status: "suspended" as const }];
    expect(cardState(list[0], cards)).toBe("published");
    expect(cardState(list[2], cards)).toBe("suspended");
    expect(cardState(list[1], cards)).toBe("none");
    expect(cardState(list[0], undefined)).toBe("none");
  });
  it("spots emails already in the team", () => {
    const inv = parseInvites("SARA@co.com\nnew@co.com", "employee").invites;
    expect(alreadyInTeam(inv, list)).toEqual(["sara@co.com"]);
  });
});
