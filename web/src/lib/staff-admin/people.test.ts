import { describe, expect, it } from "vitest";
import { NO_FILTERS, anyFilter, moreCompanies, pageCount, peopleQuery, personBadges, planText, rangeText } from "./people";

describe("peopleQuery", () => {
  it("asks for the first page, newest first, without empty filters", () => {
    expect(peopleQuery(NO_FILTERS)).toEqual({ limit: "25", offset: "0", sort: "newest" });
  });
  it("turns the page into an offset and keeps the filters that are set", () => {
    const q = peopleQuery({ ...NO_FILTERS, q: " ann ", plan: "none", status: "disabled", joinedFrom: "2026-01-01", sort: "name", page: 3 });
    expect(q).toEqual({ limit: "25", offset: "50", sort: "name", q: "ann", plan: "none", status: "disabled", joined_from: "2026-01-01" });
  });
});

describe("range and pages", () => {
  it("writes the range", () => {
    expect(rangeText(0, 25, 312)).toBe("1-25 of 312");
    expect(rangeText(300, 12, 312)).toBe("301-312 of 312");
    expect(rangeText(0, 0, 0)).toBe("0 results");
  });
  it("counts pages", () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(25)).toBe(1);
    expect(pageCount(26)).toBe(2);
  });
  it("knows when a filter is set", () => {
    expect(anyFilter(NO_FILTERS)).toBe(false);
    expect(anyFilter({ ...NO_FILTERS, q: "  " })).toBe(false);
    expect(anyFilter({ ...NO_FILTERS, hasCompany: "true" })).toBe(true);
  });
});

describe("cells", () => {
  it("words the plan", () => {
    expect(planText({ plan: "Personal", state: "live" })).toBe("Personal, live");
    expect(planText({ plan: "Personal", state: "expired" })).toBe("Personal, ended");
    expect(planText({ plan: null, state: "none" })).toBe("No plan");
  });
  it("shows badges for staff and for accounts that are off", () => {
    expect(personBadges({ staff_role: "none", status: "active" })).toEqual([]);
    expect(personBadges({ staff_role: "admin", status: "disabled" }).map((b) => b.text)).toEqual(["Staff: Admin", "Disabled"]);
    expect(personBadges({ staff_role: "none", status: "deletion_pending" })[0].tone).toBe("warn");
  });
  it("counts the companies that are not shown", () => {
    expect(moreCompanies({ company_count: 5, companies: [{}, {}, {}] as never })).toBe(2);
    expect(moreCompanies({ company_count: 1, companies: [{}] as never })).toBe(0);
  });
});
