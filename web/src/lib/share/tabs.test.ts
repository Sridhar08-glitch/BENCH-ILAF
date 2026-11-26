import { describe, expect, it } from "vitest";
import { LEGACY_ROUTES, activeShareTab, shareTabs } from "./tabs";

describe("the Share hub", () => {
  it("lists the five sections, the wallet pass only where it is offered", () => {
    expect(shareTabs({ wallet: true }).map((t) => t.id)).toEqual(["qr", "nfc", "signature", "wallet", "event"]);
    expect(shareTabs({ wallet: false }).map((t) => t.id)).toEqual(["qr", "nfc", "signature", "event"]);
  });

  it("knows the section from the path", () => {
    expect(activeShareTab("/app/share")).toBe("qr");
    expect(activeShareTab("/app/share/nfc")).toBe("nfc");
    expect(activeShareTab("/app/share/signature")).toBe("signature");
    expect(activeShareTab("/app/share/wallet")).toBe("wallet");
    expect(activeShareTab("/app/share/event")).toBe("event");
    expect(activeShareTab("/app/share/event/x")).toBe("event");
  });

  it("the old addresses lead to the right section", () => {
    const map = Object.fromEntries(LEGACY_ROUTES.map((r) => [r.source, r.destination]));
    expect(map["/app/qr"]).toBe("/app/share");
    expect(map["/app/nfc"]).toBe("/app/share/nfc");
    expect(map["/app/signature"]).toBe("/app/share/signature");
    expect(map["/app/event"]).toBe("/app/share/event");
    expect(map["/app/scan"]).toBe("/app/contacts/scan");
  });
});
