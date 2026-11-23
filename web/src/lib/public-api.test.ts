import { afterEach, describe, expect, it, vi } from "vitest";
import { publicCardCacheInit } from "./public-api";

describe("publicCardCacheInit", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("asks the API on every visit by default, so a hidden card disappears at once", () => {
    vi.stubEnv("PUBLIC_CARD_REVALIDATE", "");
    expect(publicCardCacheInit()).toEqual({ cache: "no-store" });
  });

  it("asks every time when the setting is 0 or not a number", () => {
    vi.stubEnv("PUBLIC_CARD_REVALIDATE", "0");
    expect(publicCardCacheInit()).toEqual({ cache: "no-store" });
    vi.stubEnv("PUBLIC_CARD_REVALIDATE", "soon");
    expect(publicCardCacheInit()).toEqual({ cache: "no-store" });
  });

  it("keeps the answer for the given seconds only when the setting asks for it", () => {
    vi.stubEnv("PUBLIC_CARD_REVALIDATE", "30");
    expect(publicCardCacheInit()).toEqual({ next: { revalidate: 30 } });
  });
});
