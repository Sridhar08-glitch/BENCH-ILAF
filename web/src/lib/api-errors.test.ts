import { afterEach, describe, expect, it } from "vitest";
import { ApiError, errorFromResponse, isClosedForDeletion, isReauthError, waitingError } from "./api";
import { IMAGE_ACCEPT, isAllowedImage } from "./images";
import { clearThrottle, secondsLeft } from "./throttle";

const res = (status: number, headers: Record<string, string> = {}) => ({ status, headers: { get: (n: string) => headers[n.toLowerCase()] ?? null } });

afterEach(() => clearThrottle());

describe("errors from the API", () => {
  it("turns a 429 into a throttled error with the wait, and starts the wait", () => {
    const e = errorFromResponse(res(429, { "retry-after": "42" }), { error: { code: "throttled", message: "Slow down" } });
    expect(e).toBeInstanceOf(ApiError);
    expect(e.code).toBe("throttled");
    expect(e.status).toBe(429);
    expect(e.retryAfter).toBe(42);
    expect(secondsLeft()).toBeGreaterThan(40);
  });

  it("stops a change at once while a wait is running, without asking the server", () => {
    expect(waitingError()).toBeNull();
    errorFromResponse(res(429, { "retry-after": "20" }), null);
    const w = waitingError();
    expect(w?.code).toBe("throttled");
    expect(w?.retryAfter).toBeGreaterThan(0);
  });

  it("recognises the re-authentication and closed-company answers", () => {
    expect(isReauthError(errorFromResponse(res(403), { error: { code: "reauth_required", message: "m", fields: { password: ["Enter it"] } } }))).toBe(true);
    expect(isReauthError(errorFromResponse(res(403), { error: { code: "forbidden", message: "m" } }))).toBe(false);
    expect(isClosedForDeletion(errorFromResponse(res(403), { error: { code: "workspace_pending_deletion", message: "m" } }))).toBe(true);
    expect(isClosedForDeletion(new Error("x"))).toBe(false);
  });

  it("keeps the API's message and fields for everything else", () => {
    const e = errorFromResponse(res(400), { error: { code: "validation_error", message: "Bad", fields: { url: ["Use https"] } } });
    expect(e.message).toBe("Bad");
    expect(e.field("url")).toBe("Use https");
    expect(e.retryAfter).toBe(0);
  });

  it("handles an answer that is not JSON", () => {
    const e = errorFromResponse(res(502), null);
    expect(e.code).toBe("error");
  });
});

describe("picture uploads", () => {
  it("accept only PNG, JPG and WebP", () => {
    expect(IMAGE_ACCEPT).toBe("image/png,image/jpeg,image/webp");
    for (const type of ["image/png", "image/jpeg", "image/jpg", "image/webp"]) expect(isAllowedImage({ type, name: "a" })).toBe(true);
    for (const type of ["image/gif", "image/svg+xml", "image/heic", "application/pdf", "image/x-icon"]) expect(isAllowedImage({ type, name: "a.png" })).toBe(false);
  });
  it("falls back to the file name only when the browser gave no type", () => {
    expect(isAllowedImage({ type: "", name: "photo.JPG" })).toBe(true);
    expect(isAllowedImage({ type: "", name: "logo.svg" })).toBe(false);
  });
});
