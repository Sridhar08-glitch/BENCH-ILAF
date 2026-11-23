import { describe, expect, it } from "vitest";
import { buildContext, contextLines, pathOnly } from "./context";
import { linkify } from "./linkify";
import { FOCUSED_MS, HIDDEN_MS, IDLE_STOP_MS, MAX_BACKOFF_MS, isIdle, mergeMessages, nextCursor, pollDelay, shouldSendTyping } from "./poll";
import { meetsDifficulty, sha256Hex, solveChallenge } from "./pow";
import { MAX_BODY, MAX_FILES, MAX_FILE_BYTES, checkFiles, chatBodyOk, validEmail, validateTicket } from "./validation";

describe("polling", () => {
  it("asks every 2 seconds while focused and every 8 while hidden", () => {
    expect(pollDelay({ focused: true, failures: 0 })).toBe(FOCUSED_MS);
    expect(pollDelay({ focused: false, failures: 0 })).toBe(HIDDEN_MS);
    expect(FOCUSED_MS).toBe(2000);
    expect(HIDDEN_MS).toBe(8000);
  });
  it("backs off exponentially after errors and stops growing at the cap", () => {
    const d = [1, 2, 3, 4].map((failures) => pollDelay({ focused: true, failures }));
    expect(d).toEqual([4000, 8000, 16000, 30000]);
    expect(pollDelay({ focused: false, failures: 50 })).toBe(MAX_BACKOFF_MS);
    expect(pollDelay({ focused: true, failures: 0 })).toBe(2000);
  });
  it("stops after a long idle time", () => {
    expect(isIdle(0, IDLE_STOP_MS - 1)).toBe(false);
    expect(isIdle(0, IDLE_STOP_MS)).toBe(true);
  });
  it("keeps the newest message id as the cursor", () => {
    expect(nextCursor(5, [])).toBe(5);
    expect(nextCursor(5, [{ id: 7 }, { id: 6 }])).toBe(7);
    expect(nextCursor(9, [{ id: 7 }])).toBe(9);
  });
  it("never shows a message twice and keeps them in order", () => {
    const a = [{ id: 1 }, { id: 2 }];
    expect(mergeMessages(a, [{ id: 2 }])).toBe(a);
    expect(mergeMessages(a, [{ id: 4 }, { id: 3 }, { id: 2 }]).map((m) => m.id)).toEqual([1, 2, 3, 4]);
    expect(mergeMessages(a, [])).toBe(a);
  });
  it("sends the typing notice at most every few seconds", () => {
    expect(shouldSendTyping(0, 1000)).toBe(false);
    expect(shouldSendTyping(0, 4000)).toBe(true);
  });
});

describe("context capture", () => {
  it("keeps only the path of the page", () => {
    expect(pathOnly("https://app.example.com/app/cards?token=abc#x")).toBe("/app/cards");
    expect(pathOnly("/app/cards?x=1")).toBe("/app/cards");
    expect(pathOnly("javascript:alert(1)")).toBe("");
    expect(pathOnly("not a path")).toBe("");
    expect(pathOnly("/a".repeat(150))).toBe("");
  });
  it("allows ids in a path but drops opaque tokens", () => {
    expect(pathOnly("/app/cards/3f2504e0-4f89-41d3-9a0c-0305e82c3301")).toBe("/app/cards/3f2504e0-4f89-41d3-9a0c-0305e82c3301");
    expect(pathOnly("/reset/" + "a1b2c3d4".repeat(5))).toBe("");
    expect(pathOnly("/data-download/token")).toBe("");
  });
  it("carries no secrets", () => {
    const ctx = buildContext({
      pathname: "/app/billing?session=zzz", language: "ar", buildId: "eyJhbGciOiJIUzI1NiJ9.x.y", workspaceId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      screen: { w: 1280.4, h: 720 },
    });
    expect(ctx).toEqual({ page_url: "/app/billing", route: "/app/billing", app_language: "ar", workspace_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", screen: { w: 1280, h: 720 } });
    expect(JSON.stringify(ctx)).not.toMatch(/eyJ|session|password|cookie/i);
    expect(Object.keys(buildContext({ pathname: "/app" })).sort()).toEqual(["page_url", "route"]);
  });
  it("rejects silly screen sizes and lists what is sent", () => {
    expect(buildContext({ screen: { w: -1, h: 5 } }).screen).toBeUndefined();
    expect(buildContext({ screen: { w: NaN, h: 5 } }).screen).toBeUndefined();
    const lines = contextLines(buildContext({ pathname: "/app", language: "en", screen: { w: 10, h: 20 } }));
    expect(lines.map((l) => l.key)).toEqual(["page", "language", "screen"]);
    expect(lines[2].value).toBe("10 x 20");
  });
});

describe("form validation", () => {
  const ok = { category: "bug", subject: "Cannot save", body: "It fails" };
  it("accepts a complete request", () => {
    expect(validateTicket(ok)).toEqual({});
  });
  it("reports each missing or long field", () => {
    expect(validateTicket({ category: "", subject: " ", body: "" })).toEqual({ category: "categoryRequired", subject: "subjectRequired", body: "bodyRequired" });
    expect(validateTicket({ ...ok, subject: "x".repeat(201) }).subject).toBe("subjectLong");
    expect(validateTicket({ ...ok, body: "x".repeat(MAX_BODY + 1) }).body).toBe("bodyLong");
    expect(validateTicket({ ...ok, category: "nope" }).category).toBe("categoryRequired");
  });
  it("asks visitors for a name and a valid e-mail", () => {
    expect(validateTicket(ok, true)).toEqual({ name: "nameRequired", email: "emailInvalid" });
    expect(validateTicket({ ...ok, name: "Vera", email: "vera@example.org" }, true)).toEqual({});
    expect(validEmail("a@b")).toBe(false);
    expect(validEmail(" a@b.co ")).toBe(true);
  });
  it("checks files: count, size, type", () => {
    const f = (name: string, size = 100) => ({ name, size });
    expect(checkFiles([f("a.png"), f("b.PDF"), f("c.log"), f("d.txt"), f("e.webp")])).toBeNull();
    expect(checkFiles(Array.from({ length: MAX_FILES + 1 }, (_, i) => f(`${i}.png`)))).toBe("tooManyFiles");
    expect(checkFiles([f("a.png")], MAX_FILES)).toBe("tooManyFiles");
    expect(checkFiles([f("a.png", MAX_FILE_BYTES + 1)])).toBe("fileTooBig");
    expect(checkFiles([f("a.exe")])).toBe("fileType");
    expect(checkFiles([f("a.svg")])).toBe("fileType");
  });
  it("limits chat messages", () => {
    expect(chatBodyOk("  ")).toBe(false);
    expect(chatBodyOk("hello")).toBe(true);
    expect(chatBodyOk("x".repeat(2001))).toBe(false);
  });
});

describe("safe links", () => {
  it("links only http and https addresses", () => {
    const parts = linkify("See https://example.com/a?b=1, and javascript:alert(1) or http://x.org.");
    expect(parts.filter((p) => p.type === "link").map((p) => p.type === "link" && p.href)).toEqual(["https://example.com/a?b=1", "http://x.org/"]);
    expect(parts.map((p) => p.value).join("")).toBe("See https://example.com/a?b=1, and javascript:alert(1) or http://x.org.");
  });
  it("leaves plain text and html alone", () => {
    expect(linkify("<b>bold</b> no links")).toEqual([{ type: "text", value: "<b>bold</b> no links" }]);
    expect(linkify("")).toEqual([{ type: "text", value: "" }]);
  });
  it("works with Arabic text around a link", () => {
    const parts = linkify("زوروا https://ilaf.qa/help، شكرًا");
    expect(parts.some((p) => p.type === "link" && p.href === "https://ilaf.qa/help")).toBe(true);
    expect(parts.map((p) => p.value).join("")).toBe("زوروا https://ilaf.qa/help، شكرًا");
  });
});

describe("proof of work", () => {
  it("hashes like sha-256", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("finds a counter that meets the difficulty", async () => {
    const counter = await solveChallenge("1700000000.abcd.sig", 2);
    expect(counter).not.toBeNull();
    expect(await meetsDifficulty("1700000000.abcd.sig", counter as number, 2)).toBe(true);
    expect(await meetsDifficulty("1700000000.abcd.sig", (counter as number) + 0, 6)).toBe(false);
  });
  it("can be cancelled", async () => {
    const flag = { cancelled: true };
    expect(await solveChallenge("x", 40, 1, flag)).toBeNull();
  });
});
