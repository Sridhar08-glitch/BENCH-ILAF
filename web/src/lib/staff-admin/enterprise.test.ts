import { describe, expect, it } from "vitest";
import { fmtMoney, STATUS_TONE, toMinor } from "./enterprise";

describe("Enterprise quote price", () => {
  it("turns a typed price into minor units", () => {
    expect(toMinor("25")).toBe(2500);
    expect(toMinor("25.5")).toBe(2550);
    expect(toMinor(" 25,50 ")).toBe(2550);
    expect(toMinor("0.01")).toBe(1);
    expect(toMinor("1234.56")).toBe(123456);
  });

  it("refuses anything that is not a positive amount with at most two decimals", () => {
    for (const bad of ["", "0", "0.00", "-5", "abc", "1.234", "1e3", "12 QAR", ".5"]) expect(toMinor(bad), bad).toBeNull();
  });

  it("formats money for the table", () => {
    expect(fmtMoney(50000, "QAR")).toBe("500.00 QAR");
    expect(fmtMoney(123456, "QAR")).toBe("1,234.56 QAR");
    expect(fmtMoney(null, "QAR")).toBe("-");
  });

  it("has a tone for every status", () => {
    for (const s of ["requested", "quoted", "accepted", "declined", "cancelled"]) expect(STATUS_TONE).toHaveProperty(s);
  });
});
