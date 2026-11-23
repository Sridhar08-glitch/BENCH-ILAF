import { describe, expect, it } from "vitest";
import { replay, settleStage } from "./enhance";

// A minimal stand-in for the elements replay touches (the tests run without a browser).
function el() {
  const set = new Set<string>();
  return { classList: { add: (c: string) => set.add(c), remove: (c: string) => set.delete(c), contains: (c: string) => set.has(c) }, offsetWidth: 0 };
}

function root() {
  const stg = el();
  const pg = el();
  const r = { querySelector: (s: string) => (s === ".stg" ? stg : s === ".pg" ? pg : null) };
  return { r: r as unknown as HTMLElement, stg, pg };
}

describe("opening animation and the flat card", () => {
  it("plays the opening with perspective and drops it when the stage is settled", () => {
    const { r, stg, pg } = root();
    replay(r);
    expect(stg.classList.contains("go")).toBe(true);
    expect(pg.classList.contains("go")).toBe(true);
    expect(stg.classList.contains("still")).toBe(false);
    settleStage(r);
    expect(stg.classList.contains("still")).toBe(true);
  });

  it("starts the next opening with perspective again", () => {
    const { r, stg } = root();
    replay(r);
    settleStage(r);
    replay(r);
    expect(stg.classList.contains("go")).toBe(true);
    expect(stg.classList.contains("still")).toBe(false);
  });
});
