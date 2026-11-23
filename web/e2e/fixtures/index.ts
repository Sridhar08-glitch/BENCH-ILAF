import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";
import { WEB_URL, type TestUser } from "./api";

export { expect };
export * from "./api";
export * from "./mail";

/** Signs the browser in without typing: the same call the sign-in form makes, so the session cookies are real. */
export async function signInContext(context: BrowserContext, user: Pick<TestUser, "email" | "password">, workspaceId?: string) {
  // The dashboard opens the personal workspace unless the browser remembers another one (the workspace picker stores its choice here).
  if (workspaceId) await context.addInitScript((id) => { try { localStorage.setItem("bench.workspace", id); } catch { /* storage may be blocked */ } }, workspaceId);
  const res = await context.request.post(`${WEB_URL}/api/session/login`, {
    data: { email: user.email, password: user.password },
    headers: { Origin: WEB_URL },
  });
  expect(res.ok(), `session login for ${user.email} answered ${res.status()}`).toBeTruthy();
}

/** `workspaceId` makes the dashboard open that workspace (for example a company) instead of the personal one. */
export async function signIn(page: Page, user: Pick<TestUser, "email" | "password">, workspaceId?: string) {
  await signInContext(page.context(), user, workspaceId);
}

/** Opens a dashboard path and waits until the signed-in shell is there. */
export async function openApp(page: Page, route: string) {
  await page.goto(route);
  await expect(page.locator("main, [role=main]").first()).toBeVisible();
}

/** True when the website answers 200 for this path (used to skip tests for pages that do not exist yet). */
export async function routeExists(page: Page, route: string): Promise<boolean> {
  const res = await page.request.get(`${WEB_URL}${route}`, { maxRedirects: 0, failOnStatusCode: false });
  return res.status() !== 404;
}

export const test = base;
export * from "./company";
