import { describe, expect, it } from "vitest";
import { addressHost, cardHref, directoryHref, shortAddress } from "./card-address";

describe("card address", () => {
  const bench = { public_url: "https://app.bench.qa/c/ahmed", slug: "ahmed", public_code: "abcdefghjk" };
  const own = { public_url: "https://cards.northgate.com/ahmed", slug: "ahmed", public_code: "abcdefghjk" };

  it("shows the short Bench host until the company's domain is live", () => {
    expect(shortAddress(bench, "ilaf.one")).toBe("ilaf.one/ahmed");
    expect(addressHost(bench, "ilaf.one")).toBe("ilaf.one");
    expect(shortAddress({ ...bench, slug: null }, "ilaf.one")).toBe("ilaf.one/abcdefghjk");
    expect(shortAddress({ public_code: "abcdefghjk" }, "ilaf.one")).toBe("ilaf.one/abcdefghjk");
  });
  it("shows the company domain once the API builds the address on it", () => {
    expect(shortAddress(own, "ilaf.one")).toBe("cards.northgate.com/ahmed");
    expect(addressHost(own, "ilaf.one")).toBe("cards.northgate.com");
  });
  it("links under a card on the host the visitor is on", () => {
    expect(cardHref("ahmed", null)).toBe("/c/ahmed");
    expect(cardHref("ahmed", "cards.northgate.com")).toBe("/ahmed");
    expect(cardHref("ahmed", "cards.northgate.com", "/report")).toBe("/ahmed/report");
    expect(cardHref("a b", null, "/report")).toBe("/c/a%20b/report");
    expect(directoryHref("northgate", null)).toBe("/d/northgate");
    expect(directoryHref("northgate", "cards.northgate.com")).toBe("/");
  });
});
