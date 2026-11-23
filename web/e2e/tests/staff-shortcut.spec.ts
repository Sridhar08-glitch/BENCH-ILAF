import { execSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { registerSubscribed, signIn } from "../fixtures";

// Needs a command that gives an account a staff role on the throw-away database, run from the backend folder, for example
//   E2E_GRANT_STAFF_CMD="python manage.py grant_staff"   (the e-mail and the role are appended)
// plus E2E_BACKEND_DIR pointing at the backend folder, and the same DATABASE_URL as the running API in the environment.
const grant = process.env.E2E_GRANT_STAFF_CMD;
const backendDir = process.env.E2E_BACKEND_DIR;

test.describe("the staff shortcut in the workspace", () => {
  test("a customer never sees it, a staff admin does and it opens the staff area", async ({ page }) => {
    test.skip(!grant || !backendDir, "set E2E_GRANT_STAFF_CMD and E2E_BACKEND_DIR to run this test");
    const customer = await registerSubscribed({ tag: "plain" });
    await signIn(page, customer);
    await page.goto("/app");
    await expect(page.locator(".side .who")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("staff-link")).toHaveCount(0);

    const staff = await registerSubscribed({ tag: "staff" });
    execSync(`${grant} ${staff.email} admin`, { cwd: backendDir, stdio: "ignore" });
    await page.context().clearCookies();
    await signIn(page, staff);
    await page.goto("/app");
    const link = page.getByTestId("staff-link");
    await expect(link).toBeVisible();
    await expect(link).toContainText("Admin");
    await link.click();
    await expect(page).toHaveURL(/\/staff/);
    await expect(page.getByTestId("back-to-app")).toBeVisible();
    await page.getByTestId("back-to-app").click();
    await expect(page).toHaveURL(/\/app/);
  });
});
