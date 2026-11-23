import { expect, test } from "@playwright/test";
import { PASSWORD, api, clearMails, linkTo, localise, registerUser, signIn, uniqueEmail, waitForMail, WEB_URL } from "../fixtures";
import { remember } from "../fixtures/api";

test.describe("accounts", () => {
  test("register a new account and land in the dashboard @smoke", async ({ page }) => {
    const email = uniqueEmail("register");
    remember(email);
    await page.goto("/register");
    await page.getByLabel("Full name").fill("Rania Test");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/app/);
    await expect(page.getByRole("link", { name: "Cards" }).first()).toBeVisible();
  });

  test("a wrong password is refused and the right one signs in @smoke", async ({ page }) => {
    const user = await registerUser({ tag: "login" });
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill("not-the-password-1");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert").first()).toBeVisible();
    await expect(page).toHaveURL(/\/login/);

    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/app/);
  });

  test("a signed-out visitor is sent to the sign-in page", async ({ page }) => {
    await page.goto("/app/cards");
    await expect(page).toHaveURL(/\/login/);
  });

  test("forgot password: the mail link sets a new password and the old one stops working @smoke", async ({ page }) => {
    clearMails();
    const user = await registerUser({ tag: "forgot" });
    await page.goto("/forgot");
    await page.getByLabel("Email").fill(user.email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText("Check your email")).toBeVisible();

    const mail = await waitForMail(user.email, /reset|password/i);
    const link = localise(linkTo(mail, "/reset"), WEB_URL);
    await page.goto(link);
    const fresh = "e2e-NewPassw0rd-abc";
    await page.getByLabel("New password").fill(fresh);
    await page.getByLabel("Repeat the password").fill(fresh);
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByText("Password changed")).toBeVisible();

    const old = await api("POST", "auth/login", { body: { email: user.email, password: user.password }, expect: [400, 401, 403] });
    expect(old.status).toBeGreaterThanOrEqual(400);
    const ok = await api("POST", "auth/login", { body: { email: user.email, password: fresh } });
    expect(ok.status).toBe(200);
  });

  test("sign out of all devices ends every session", async ({ browser }) => {
    const user = await registerUser({ tag: "logoutall" });
    const first = await browser.newContext();
    const second = await browser.newContext();
    try {
      await signIn(await first.newPage(), user);
      await signIn(await second.newPage(), user);
      const page = await first.newPage();
      await page.goto("/app/settings/sign-in");
      await page.getByRole("button", { name: "Sign out of all devices" }).click();
      await page.getByRole("button", { name: "Sign out everywhere" }).click();
      await expect(page).toHaveURL(/\/login/);

      // The other browser's refresh token was revoked, so its session cannot renew itself.
      const renewed = await api("POST", "auth/refresh", { body: { refresh: user.refresh }, expect: [400, 401, 403] });
      expect(renewed.status).toBeGreaterThanOrEqual(400);
    } finally {
      await first.close();
      await second.close();
    }
  });

  test("the language switch gives Arabic with right-to-left layout and back", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    const language = page.locator("select").first();
    await language.selectOption("ar");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", /ar/);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await page.locator("select").first().selectOption("en");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  });
});
