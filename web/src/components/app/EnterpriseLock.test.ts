import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "@/lib/i18n";
import { CATALOGUES } from "@/lib/i18n/messages";

// The lock note only needs the signed-in role and whether the company has the feature; the translator is the real one.
const ws: { isCompany: boolean; role: string; has: (feature: string) => boolean } = { isCompany: true, role: "owner", has: () => false };
vi.mock("@/components/app/WorkspaceContext", () => ({ useWs: () => ws }));
vi.mock("@/lib/i18n/client", () => ({ useI18n: () => createI18n("en", "latn", CATALOGUES.en) }));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: unknown; className?: string }) => createElement("a", { href, className }, children as string),
}));

const { EnterpriseGate, EnterpriseLock } = await import("./EnterpriseLock");

const page = () => renderToStaticMarkup(createElement(EnterpriseGate, { feature: "departments", title: "Departments" }, createElement("p", null, "THE REAL PAGE")));

describe("Enterprise lock", () => {
  beforeEach(() => {
    ws.isCompany = true;
    ws.role = "owner";
    ws.has = () => false;
  });

  it("shows the lock note and the quote link instead of the screen", () => {
    const html = page();
    expect(html).toContain("Part of Enterprise: ask us for a quote");
    expect(html).toContain('href="/app/billing#enterprise"');
    expect(html).toContain("Departments");
    expect(html).not.toContain("THE REAL PAGE");
  });

  it("shows the screen when the company has the feature", () => {
    ws.has = (f) => f === "departments";
    expect(page()).toContain("THE REAL PAGE");
  });

  it("never locks a personal workspace's screen", () => {
    ws.isCompany = false;
    expect(page()).toContain("THE REAL PAGE");
  });

  it("tells an admin to ask the owner instead of offering the form", () => {
    ws.role = "admin";
    const html = renderToStaticMarkup(createElement(EnterpriseLock));
    expect(html).toContain("Ask your company owner to request an Enterprise quote.");
    expect(html).not.toContain("/app/billing#enterprise");
  });

  it("has a compact form for a panel inside a page", () => {
    const html = renderToStaticMarkup(createElement(EnterpriseLock, { compact: true }));
    expect(html).toContain("Part of Enterprise");
    expect(html).not.toContain("belongs to the Enterprise plan");
  });

  it("is written in Arabic too", () => {
    const ar = createI18n("ar", "arab", CATALOGUES.ar);
    expect(ar.t("billing.entLockTitle")).toMatch(/[؀-ۿ]/);
    expect(ar.t("billing.entLockCta")).toMatch(/[؀-ۿ]/);
  });
});
