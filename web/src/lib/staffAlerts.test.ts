import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALERT_CAP, ALERT_HIDDEN_MS, ALERT_MAX_BACKOFF_MS, ALERT_VISIBLE_MS, SOUND_KEY, alertBadge, alertHref, alertInterval, alertKindKey, chatsIncreased, onSupportPage,
  readSoundPref, stripCountPrefix, titleWithCount, writeSoundPref,
} from "./staffAlerts";

describe("alertBadge", () => {
  it("shows nothing for no news or a bad value", () => {
    for (const v of [0, -1, undefined, null, Number.NaN]) expect(alertBadge(v)).toBeNull();
  });
  it("shows the count up to the cap and 99+ above it", () => {
    expect(alertBadge(7)).toEqual({ value: 7, over: false });
    expect(alertBadge(ALERT_CAP)).toEqual({ value: 99, over: false });
    expect(alertBadge(100)).toEqual({ value: 99, over: true });
    expect(alertBadge(2500)).toEqual({ value: 99, over: true });
  });
});

describe("alertInterval", () => {
  it("is 20 s visible and 60 s hidden", () => {
    expect(alertInterval(false, 0)).toBe(ALERT_VISIBLE_MS);
    expect(alertInterval(true, 0)).toBe(ALERT_HIDDEN_MS);
  });
  it("doubles after failures up to a ceiling", () => {
    expect(alertInterval(false, 1)).toBe(40_000);
    expect(alertInterval(false, 2)).toBe(80_000);
    expect(alertInterval(false, 50)).toBe(ALERT_MAX_BACKOFF_MS);
    expect(alertInterval(true, 9)).toBe(ALERT_MAX_BACKOFF_MS);
  });
});

describe("labels and links", () => {
  it("names each kind", () => {
    expect(alertKindKey("ticket")).toBe("staff.alerts.kindTicket");
    expect(alertKindKey("reply")).toBe("staff.alerts.kindReply");
    expect(alertKindKey("chat")).toBe("staff.alerts.kindChat");
  });
  it("sends a request to its page and a chat to the console", () => {
    expect(alertHref({ kind: "ticket", id: "abc" })).toBe("/staff/support/abc");
    expect(alertHref({ kind: "reply", id: "abc" })).toBe("/staff/support/abc");
    expect(alertHref({ kind: "chat", id: "abc" })).toBe("/staff/support/chats");
  });
  it("knows the support pages", () => {
    expect(onSupportPage("/staff/support")).toBe(true);
    expect(onSupportPage("/staff/support/chats")).toBe(true);
    expect(onSupportPage("/staff/support/123")).toBe(true);
    expect(onSupportPage("/staff/supportive")).toBe(false);
    expect(onSupportPage("/staff/billing")).toBe(false);
  });
});

describe("titleWithCount", () => {
  it("adds the count while away from Support", () => {
    expect(titleWithCount("Billing", 3, false, false)).toBe("(3) Billing");
  });
  it("adds the count on a hidden tab even on the Support pages", () => {
    expect(titleWithCount("Support", 3, true, true)).toBe("(3) Support");
  });
  it("leaves the title alone while the person looks at Support", () => {
    expect(titleWithCount("Support", 3, false, true)).toBe("Support");
  });
  it("restores the title at zero and never doubles the prefix", () => {
    expect(titleWithCount("(3) Billing", 0, false, false)).toBe("Billing");
    expect(titleWithCount("(3) Billing", 5, false, false)).toBe("(5) Billing");
    expect(titleWithCount("Billing", 250, true, false)).toBe("(99+) Billing");
  });
  it("strips only a count prefix", () => {
    expect(stripCountPrefix("(12) Staff")).toBe("Staff");
    expect(stripCountPrefix("(99+) Staff")).toBe("Staff");
    expect(stripCountPrefix("(draft) Staff")).toBe("(draft) Staff");
    expect(stripCountPrefix("Staff (3)")).toBe("Staff (3)");
  });
});

describe("chatsIncreased", () => {
  it("never fires on the first answer", () => {
    expect(chatsIncreased(undefined, 3)).toBe(false);
  });
  it("fires only when the count goes up", () => {
    expect(chatsIncreased(0, 1)).toBe(true);
    expect(chatsIncreased(2, 2)).toBe(false);
    expect(chatsIncreased(3, 1)).toBe(false);
  });
});

describe("the sound choice", () => {
  afterEach(() => vi.unstubAllGlobals());

  function store(seed: Record<string, string> = {}) {
    const data = { ...seed };
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => (k in data ? data[k] : null),
        setItem: (k: string, v: string) => { data[k] = v; },
      },
    });
    return data;
  }

  it("is off until turned on", () => {
    store();
    expect(readSoundPref()).toBe(false);
  });
  it("is remembered", () => {
    const data = store();
    writeSoundPref(true);
    expect(data[SOUND_KEY]).toBe("1");
    expect(readSoundPref()).toBe(true);
    writeSoundPref(false);
    expect(readSoundPref()).toBe(false);
  });
  it("survives blocked storage", () => {
    vi.stubGlobal("window", {
      localStorage: { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } },
    });
    expect(readSoundPref()).toBe(false);
    expect(() => writeSoundPref(true)).not.toThrow();
  });
});
