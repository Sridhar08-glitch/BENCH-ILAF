import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { staffShortcut } from "./shortcut";

describe("the staff shortcut in the workspace", () => {
  it("shows nothing while loading or without an answer", () => {
    expect(staffShortcut(undefined)).toBeNull();
    expect(staffShortcut(null)).toBeNull();
    expect(staffShortcut({})).toBeNull();
    expect(staffShortcut({ data: null })).toBeNull();
  });

  it("shows nothing for a refusal or a failure", () => {
    for (const status of [401, 403, 404, 0, 500]) {
      expect(staffShortcut({ error: new ApiError(status, "x", "") })).toBeNull();
    }
    expect(staffShortcut({ error: new Error("offline") })).toBeNull();
  });

  it("shows nothing for an answer without a known staff role", () => {
    expect(staffShortcut({ data: { staff_role: "none" as never } })).toBeNull();
    expect(staffShortcut({ data: {} as never })).toBeNull();
  });

  it("gives the link and the role name for a staff profile", () => {
    expect(staffShortcut({ data: { staff_role: "admin" } })).toEqual({ href: "/staff", roleKey: "staff.roleAdmin" });
    expect(staffShortcut({ data: { staff_role: "support" } })?.roleKey).toBe("staff.roleSupport");
    expect(staffShortcut({ data: { staff_role: "read_only" } })?.roleKey).toBe("staff.roleReadOnly");
  });
});
