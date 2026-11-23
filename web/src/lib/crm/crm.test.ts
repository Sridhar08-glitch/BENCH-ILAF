import { describe, expect, it } from "vitest";
import { createI18n } from "../i18n";
import { CATALOGUES } from "../i18n/messages";
import { bucketLabel, changePct, changeText, conversion, csvCell, customProblem, dayCount, defaultGroup, niceMax, sortRows, toCsv } from "./analytics";
import { NO_FILTERS, bulkSummary, describeActivity, filterCount, leadQuery, rangeProblem, statusName } from "./leads";
import type { LeadActivity, Metrics } from "./types";
import { deliveryText, urlProblem } from "./webhooks";

const i18n = createI18n("en", "latn", CATALOGUES.en);
const { t } = i18n;
// The names inside a sentence are set apart for right-to-left text; the tests read the plain words.
const plain = (s: string) => s.replace(/[⁦-⁩]/g, "");
const m = (over: Partial<Metrics>): Metrics => ({ views: 0, scans: 0, taps: 0, saves: 0, link_clicks: 0, leads: 0, won: 0, ...over });
const act = (kind: LeadActivity["kind"], details: Record<string, unknown>, actor: string | null = "Olivia"): LeadActivity => ({
  id: "1", kind, actor, details, created_at: "",
});

describe("lead filters", () => {
  it("builds the query and lets the tab win over the assignee filter", () => {
    const f = { ...NO_FILTERS, q: " ann ", status: "won", assignee: "m1", card: "c1" };
    expect(leadQuery(f, "all", 2, 50)).toMatchObject({ q: "ann", status: "won", assignee: "m1", card_id: "c1", limit: 50, offset: 100 });
    expect(leadQuery(f, "mine", 0, 50).assignee).toBe("me");
    expect(leadQuery(f, "unassigned", 0, 50).assignee).toBe("none");
    expect(leadQuery(NO_FILTERS, "all", 0, 50).assignee).toBeUndefined();
  });
  it("counts filters without the search box", () => {
    expect(filterCount(NO_FILTERS)).toBe(0);
    expect(filterCount({ ...NO_FILTERS, q: "x", status: "new", from: "2026-01-01" })).toBe(2);
  });
  it("checks the date range", () => {
    expect(rangeProblem({ from: "2026-02-01", to: "2026-01-01" }, t)).toMatch(/after/);
    expect(rangeProblem({ from: "2026-01-01", to: "" }, t)).toBeNull();
  });
  it("names statuses", () => {
    expect(statusName("qualified", t)).toBe("Qualified");
    expect(statusName("zzz", t)).toBe("zzz");
  });
  it("summarises a bulk run", () => {
    expect(bulkSummary({ ok: 1, failed: 0 }, t)).toBe("1 contact updated");
    expect(bulkSummary({ ok: 3, failed: 2 }, t)).toBe("3 updated, 2 could not be changed");
  });
});

describe("timeline sentences", () => {
  it("describes each kind", () => {
    expect(plain(describeActivity(act("created", {}), t))).toBe("Lead received");
    expect(plain(describeActivity(act("assigned", { to: "Sam", previous: null }), t))).toBe("Olivia assigned the lead to Sam");
    expect(plain(describeActivity(act("assigned", { to: "Eve", previous: "Sam" }), t))).toBe("Olivia moved the lead from Sam to Eve");
    expect(plain(describeActivity(act("assigned", { to: null, previous: "Sam" }), t))).toBe("Olivia took the lead off Sam");
    expect(plain(describeActivity(act("status_changed", { old: "new", new: "qualified" }), t))).toBe("Olivia changed the status from New to Qualified");
    expect(plain(describeActivity(act("note_added", {}, null), t))).toBe("Someone added a note");
    expect(plain(describeActivity(act("emailed", { recipients: 2 }, null), t))).toContain("2 people");
    expect(plain(describeActivity(act("emailed", { reason: "assigned", to: "sam@x.com" }, null), t))).toBe("An e-mail was sent to sam@x.com");
  });
});

describe("analytics helpers", () => {
  it("computes change against the previous period", () => {
    expect(changePct(15, 10)).toBe(50);
    expect(changePct(5, 10)).toBe(-50);
    expect(changePct(3, 0)).toBeNull();
    expect(changeText(15, 10, i18n)).toBe("+50%");
    expect(changeText(5, 10, i18n)).toBe("-50%");
    expect(changeText(3, 0, i18n)).toBe("new");
    expect(changeText(0, 0, i18n)).toBe("no change");
  });
  it("sorts by a column in both directions, ties by name", () => {
    const rows = [
      { name: "Bea", totals: m({ views: 5 }) },
      { name: "Al", totals: m({ views: 5 }) },
      { name: "Cy", totals: m({ views: 9 }) },
    ];
    expect(sortRows(rows, "views", "desc").map((r) => r.name)).toEqual(["Cy", "Al", "Bea"]);
    expect(sortRows(rows, "views", "asc").map((r) => r.name)).toEqual(["Al", "Bea", "Cy"]);
    expect(sortRows(rows, "name", "desc").map((r) => r.name)).toEqual(["Cy", "Bea", "Al"]);
    expect(rows[0].name).toBe("Bea");
  });
  it("computes conversion without dividing by zero", () => {
    expect(conversion(m({ views: 200, leads: 5 }))).toBe(2.5);
    expect(conversion(m({ views: 0, leads: 5 }))).toBe(0);
    expect(sortRows([{ name: "a", totals: m({ views: 10, leads: 1 }) }, { name: "b", totals: m({ views: 10, leads: 2 }) }], "conversion", "desc")[0].name).toBe("b");
  });
  it("validates custom ranges", () => {
    expect(dayCount("2026-01-01", "2026-01-31")).toBe(31);
    expect(customProblem("", "2026-01-01", t)).toMatch(/both/);
    expect(customProblem("2026-02-01", "2026-01-01", t)).toMatch(/after/);
    expect(customProblem("2024-01-01", "2026-01-01", t)).toMatch(/at most 365/);
    expect(customProblem("2026-01-01", "2026-01-31", t)).toBeNull();
  });
  it("picks a readable bucket size and labels", () => {
    expect(defaultGroup(30)).toBe("day");
    expect(defaultGroup(90)).toBe("week");
    expect(defaultGroup(365)).toBe("month");
    expect(bucketLabel("2026-11-09", "day", i18n.date)).toBe("9 Nov");
    expect(bucketLabel("2026-11-01", "month", i18n.date)).toBe("Nov 26");
  });
  it("rounds chart maxima up", () => {
    expect([niceMax(0), niceMax(7), niceMax(23), niceMax(51), niceMax(900)]).toEqual([4, 10, 50, 100, 1000]);
  });
});

describe("csv", () => {
  it("quotes, escapes and defuses formulas", () => {
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("-1+2")).toBe("'-1+2");
    expect(csvCell(null)).toBe("");
    expect(csvCell(0)).toBe("0");
  });
  it("starts with a byte-order mark and ends rows with CRLF", () => {
    const t = toCsv(["a", "b"], [["x", 1]]);
    expect(t.startsWith("﻿")).toBe(true);
    expect(t).toBe("﻿a,b\r\nx,1\r\n");
  });
});

describe("webhooks", () => {
  it("checks the address", () => {
    expect(urlProblem("")).toMatch(/Enter/);
    expect(urlProblem("hooks.example.com")).toMatch(/full web address/);
    expect(urlProblem("http://hooks.example.com")).toMatch(/https/);
    expect(urlProblem("https://u:p@hooks.example.com")).toMatch(/user name/);
    expect(urlProblem("https://hooks.zapier.com/hooks/catch/1/a")).toBeNull();
  });
  it("describes deliveries", () => {
    const base = { id: "1", event_id: "e", event_type: "lead.created", attempts: 1, response_status: 200, error: "", duration_ms: 10, is_test: false, next_attempt_at: null, created_at: "", delivered_at: null };
    expect(deliveryText({ ...base, status: "success" })).toBe("Delivered (200)");
    expect(deliveryText({ ...base, status: "pending", error: "boom" })).toBe("Will retry: boom");
    expect(deliveryText({ ...base, status: "failed", response_status: null, error: "" })).toBe("Failed (no answer)");
  });
});
