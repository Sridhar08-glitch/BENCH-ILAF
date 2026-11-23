import { expect, test } from "@playwright/test";
import { api, registerSubscribed, routeExists, signIn } from "../fixtures";
import { skipReason } from "../fixtures/helpers";

test.describe("help and support", () => {
  test("the help centre lists guides and opens an article @smoke", async ({ page }) => {
    const user = await registerSubscribed({ tag: "help" });
    await signIn(page, user);
    await page.goto("/app/help");
    await expect(page.getByRole("heading", { name: "Help centre" })).toBeVisible();
    await page.getByRole("link", { name: /Choose a design/ }).first().click();
    await expect(page).toHaveURL(/\/app\/help\/choose-a-design/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/design/i);
  });

  test("help search narrows the list of guides", async ({ page }) => {
    const user = await registerSubscribed({ tag: "helpsearch" });
    await signIn(page, user);
    await page.goto("/app/help");
    await page.waitForLoadState("networkidle");
    await page.getByRole("searchbox").fill("webhook");
    await expect(page.getByRole("link", { name: /Integrations and webhooks/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Choose a design/ })).toHaveCount(0);
  });

  test("create a support request and see it in the list", async ({ page }) => {
    const user = await registerSubscribed({ tag: "support" });
    await signIn(page, user);
    test.skip(!(await routeExists(page, "/app/support/new")), skipReason("/app/support/new"));
    await page.goto("/app/support/new");
    await page.waitForLoadState("networkidle");
    const subject = `E2E question ${Date.now().toString(36)}`;
    await page.getByLabel("What is it about?").selectOption({ index: 1 });
    await page.getByLabel("Subject").fill(subject);
    await page.getByLabel("Message").fill("Hello, this is an automated end-to-end test request.");
    await page.getByRole("button", { name: /^Send/ }).click();
    await expect(page.getByText(subject).first()).toBeVisible();

    const { data } = await api<{ results?: { subject: string }[] } | { subject: string }[]>("GET", "support/tickets", { token: user.access });
    const tickets = Array.isArray(data) ? data : (data.results ?? []);
    expect(tickets.some((t) => t.subject === subject)).toBeTruthy();
  });
});
