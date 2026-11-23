import { describe, expect, it } from "vitest";
import { pushState, urlBase64ToUint8Array } from "./push-client";

describe("push helpers", () => {
  it("turns the server key into bytes", () => {
    const bytes = urlBase64ToUint8Array("BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8");
    expect(bytes).toHaveLength(65);
    expect(bytes[0]).toBe(4);
    expect(Array.from(urlBase64ToUint8Array("AQID"))).toEqual([1, 2, 3]);
    expect(Array.from(urlBase64ToUint8Array("-_8"))).toEqual([251, 255]);
  });

  it("decides what the opt-in button shows", () => {
    expect(pushState(false, "default", false)).toBe("unsupported");
    expect(pushState(true, "denied", true)).toBe("denied");
    expect(pushState(true, "default", false)).toBe("off");
    expect(pushState(true, "granted", false)).toBe("off");
    expect(pushState(true, "granted", true)).toBe("on");
    expect(pushState(true, "default", true)).toBe("off");
  });
});
