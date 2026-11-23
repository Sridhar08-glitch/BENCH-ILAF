import { expect, test, type Page } from "@playwright/test";
import { api, registerSubscribed, signIn } from "../fixtures";

/** The "confirm it is you" step some sensitive actions ask for. It only appears when the last sign-in is not recent. */
async function confirmPasswordIfAsked(page: Page, password: string) {
  const dialog = page.getByRole("dialog", { name: "Confirm it is you" });
  if (await dialog.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await dialog.locator('input[type="password"]').fill(password);
    await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  }
}

test.describe("my data and my account", () => {
  test("request an export of my data", async ({ page }) => {
    const user = await registerSubscribed({ tag: "export" });
    await signIn(page, user);
    await page.goto("/app/settings/privacy");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Export my data" }).first().click();
    await confirmPasswordIfAsked(page, user.password);
    await expect(page.getByText(/We are preparing your file|Your file is ready/)).toBeVisible();

    const { data } = await api<{ results?: { kind: string }[] } | { kind: string }[]>("GET", "privacy/requests", { token: user.access });
    const list = Array.isArray(data) ? data : (data.results ?? []);
    expect(list.some((r) => r.kind === "export")).toBeTruthy();
  });

  test("delete the account, then restore it by signing in again", async ({ page }) => {
    const user = await registerSubscribed({ tag: "delete" });
    await signIn(page, user);
    await page.goto("/app/settings/privacy");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Delete my account..." }).click();
    const dialog = page.getByRole("dialog", { name: "Delete my account" });
    await dialog.getByLabel(/Type DELETE to confirm/).fill("DELETE");
    // The dialog also asks for the password (or a fresh Google sign-in) before the delete button works.
    await dialog.locator('input[type="password"]').fill(user.password);
    await dialog.getByRole("button", { name: "Delete my account", exact: true }).click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText("Your account is scheduled for deletion")).toBeVisible();

    // Inside the grace period the person can sign in and bring everything back.
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("button", { name: "Restore my account" }).click();
    await expect(page).toHaveURL(/\/app/);

    const me = await api<{ email: string }>("POST", "auth/login", { body: { email: user.email, password: user.password } });
    expect(me.status).toBe(200);
  });
});
