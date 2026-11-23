import { describe, expect, it } from "vitest";
import { bulkSummary, changeText, errorRateTone, fmtPercent, monthLabel, reportNumber, storageShares, versusText } from "./health";

describe("change and comparison hints", () => {
  it("signs the change", () => {
    expect(changeText(3, "in 4 weeks")).toBe("+3 in 4 weeks");
    expect(changeText(0, "in 4 weeks")).toBe("0 in 4 weeks");
    expect(changeText(-2, "this week")).toBe("-2 this week");
    expect(changeText(1200, "views")).toBe("+1,200 views");
  });
  it("compares with the period before", () => {
    expect(versusText(106, 100, "yesterday")).toBe("+6% vs yesterday");
    expect(versusText(1062, 1000, "yesterday")).toBe("+6.2% vs yesterday");
    expect(versusText(50, 100, "last week")).toBe("-50% vs last week");
    expect(versusText(10, 10, "last week")).toBe("no change vs last week");
    expect(versusText(0, 0, "last week")).toBe("no change vs last week");
    expect(versusText(4, 0, "last week")).toBe("4 vs none last week");
  });
});

describe("percent and tone", () => {
  it("shows a dash when nothing is known", () => {
    expect(fmtPercent(null)).toBe("-");
    expect(fmtPercent(99.5)).toBe("99.5%");
    expect(fmtPercent(100)).toBe("100%");
    expect(fmtPercent(0.123, 1)).toBe("0.1%");
  });
  it("judges the error rate", () => {
    expect(errorRateTone(null)).toBe("ok");
    expect(errorRateTone(0)).toBe("ok");
    expect(errorRateTone(0.4)).toBe("warn");
    expect(errorRateTone(3)).toBe("bad");
  });
});

describe("storage shares", () => {
  it("splits the total in whole percent and survives an empty total", () => {
    const rows = storageShares([{ key: "a", label: "A", bytes: 300 }, { key: "b", label: "B", bytes: 100 }]);
    expect(rows.map((r) => r.share)).toEqual([75, 25]);
    expect(storageShares([{ key: "a", label: "A", bytes: 0 }])[0].share).toBe(0);
  });
});

describe("labels", () => {
  it("writes the month", () => {
    expect(monthLabel("2026-08")).toBe("Aug 2026");
    expect(monthLabel("junk")).toBe("junk");
  });
  it("shows the short report number, with the id as a fallback", () => {
    expect(reportNumber({ short_id: "R-00042", id: "abcdef12-0000" })).toBe("R-00042");
    expect(reportNumber({ short_id: "", id: "abcdef12-0000" })).toBe("abcdef12");
  });
  it("summarises a bulk run", () => {
    expect(bulkSummary([{ ok: true }, { ok: true }])).toBe("2 of 2 done");
    expect(bulkSummary([{ ok: true }, { ok: false, error: "not_open" }, { ok: false, error: "not_open" }], "warned")).toBe("1 of 3 warned; 2 skipped (not_open)");
  });
});
