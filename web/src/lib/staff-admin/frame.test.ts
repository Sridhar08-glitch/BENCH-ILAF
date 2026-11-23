import { describe, expect, it } from "vitest";
import type { SearchResult } from "./api";
import {
  audienceReady, audienceSentence, companyHref, countFor, countryName, incomingCompanyIds, isSearchShortcut, moveActive, parseIdList, searchAllHref, searchRows, toggleValue,
} from "./frame";

const ID_A = "0b1c2d3e-0000-4000-8000-000000000001";
const ID_B = "0b1c2d3e-0000-4000-8000-000000000002";

function result(over: Partial<SearchResult> = {}): SearchResult {
  return { companies: [], people: [], cards: [], ...over };
}

describe("searchRows", () => {
  it("is empty without a result", () => {
    expect(searchRows(undefined)).toEqual([]);
    expect(searchRows(result())).toEqual([]);
  });

  it("lists companies, then people, then cards, each with a readable second line", () => {
    const rows = searchRows(result({
      companies: [{ id: "c1", name: "Acme Ltd", owner_email: "owner@acme.test" } as SearchResult["companies"][number]],
      people: [{ id: "u1", email: "ann@x.test", full_name: "Ann Lee", staff_role: "none", is_active: true, companies: [{ id: "c1", name: "Acme Ltd", role: "owner" }] }],
      cards: [{ id: "k1", name: "Ann Lee", public_url: "https://bench.test/c/AB12", workspace_name: "Acme Ltd" } as SearchResult["cards"][number]],
    }));
    expect(rows.map((r) => r.kind)).toEqual(["company", "person", "card"]);
    expect(rows[0]).toMatchObject({ title: "Acme Ltd", sub: "owner@acme.test" });
    expect(rows[1]).toMatchObject({ title: "Ann Lee", sub: "ann@x.test - Acme Ltd" });
    expect(rows[2]).toMatchObject({ title: "Ann Lee", sub: "bench.test/c/AB12 - Acme Ltd" });
  });

  it("shows the e-mail as the title of a person without a name and cuts each group", () => {
    const people = Array.from({ length: 9 }, (_, i) => ({ id: `u${i}`, email: `p${i}@x.test`, full_name: "", staff_role: "none", is_active: true, companies: [] }));
    const rows = searchRows(result({ people }));
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({ title: "p0@x.test", sub: "" });
  });
});

describe("search links and keys", () => {
  it("builds the see-all and company links", () => {
    expect(searchAllHref("  anna lee ")).toBe("/staff/people?q=anna%20lee");
    expect(companyHref("abc")).toBe("/staff/companies/abc");
  });

  it("moves the highlight round the list", () => {
    expect(moveActive(-1, 3, "ArrowDown")).toBe(0);
    expect(moveActive(2, 3, "ArrowDown")).toBe(0);
    expect(moveActive(0, 3, "ArrowUp")).toBe(2);
    expect(moveActive(1, 3, "ArrowUp")).toBe(0);
    expect(moveActive(0, 0, "ArrowDown")).toBe(-1);
  });

  it("takes / as the search shortcut only outside text fields", () => {
    expect(isSearchShortcut({ key: "/", target: { tagName: "BODY" } as unknown as EventTarget })).toBe(true);
    expect(isSearchShortcut({ key: "/", target: { tagName: "INPUT" } as unknown as EventTarget })).toBe(false);
    expect(isSearchShortcut({ key: "/", target: { tagName: "TEXTAREA" } as unknown as EventTarget })).toBe(false);
    expect(isSearchShortcut({ key: "/", target: { tagName: "DIV", isContentEditable: true } as unknown as EventTarget })).toBe(false);
    expect(isSearchShortcut({ key: "/", ctrlKey: true })).toBe(false);
    expect(isSearchShortcut({ key: "a" })).toBe(false);
  });
});

describe("menu counts", () => {
  it("reads the count of the two menu items and nothing else", () => {
    const counts = { open_reports: 3, open_data_requests: 0 };
    expect(countFor("/staff/abuse", counts)).toBe(3);
    expect(countFor("/staff/data-requests", counts)).toBe(0);
    expect(countFor("/staff/companies", counts)).toBeUndefined();
    expect(countFor("/staff/abuse", undefined)).toBeUndefined();
  });
});

describe("incoming company selection", () => {
  it("parses plain lists, JSON lists, junk and repeats", () => {
    expect(parseIdList(`${ID_A},${ID_B},${ID_A}`)).toEqual([ID_A, ID_B]);
    expect(parseIdList(JSON.stringify([ID_B, "nope", ID_A]))).toEqual([ID_B, ID_A]);
    expect(parseIdList("<script>,,  ")).toEqual([]);
    expect(parseIdList(null)).toEqual([]);
  });

  it("prefers the address and falls back to the browser storage", () => {
    expect(incomingCompanyIds(`?companies=${ID_A}`, JSON.stringify([ID_B]))).toEqual([ID_A]);
    expect(incomingCompanyIds("", JSON.stringify([ID_B]))).toEqual([ID_B]);
    expect(incomingCompanyIds("?companies=bad", `${ID_A}`)).toEqual([ID_A]);
    expect(incomingCompanyIds("", null)).toEqual([]);
  });
});

describe("audience helpers", () => {
  it("toggles a value in a picked list", () => {
    expect(toggleValue(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleValue(["a", "b"], "a")).toEqual(["b"]);
  });

  it("needs a value for every audience but all", () => {
    expect(audienceReady("all", [])).toBe(true);
    expect(audienceReady("plan", [])).toBe(false);
    expect(audienceReady("country", ["QA"])).toBe(true);
  });

  it("names countries and falls back to the code", () => {
    expect(countryName("qa")).toBe("Qatar (QA)");
    expect(countryName("ZZZZ")).toBe("ZZZZ");
  });

  it("writes the live count as one sentence", () => {
    expect(audienceSentence({ companies: 1, people: 2, label: "" }, { banner: true, email: true })).toBe("1 company will see the banner, 2 people will get the e-mail.");
    expect(audienceSentence({ companies: 5, people: 1, label: "" }, { banner: true, email: false })).toBe("5 companies will see the banner.");
    expect(audienceSentence({ companies: 5, people: 1, label: "" }, { banner: false, email: true })).toBe("1 person will get the e-mail.");
  });
});
