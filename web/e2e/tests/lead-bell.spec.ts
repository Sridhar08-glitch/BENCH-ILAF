import { expect, test } from "@playwright/test";
import { createLead, publishedCardFor, signIn } from "../fixtures";

// The new-contacts bell in the top bar: a badge for contacts not looked at yet, the latest few in a small list, cleared when seen.
const SHOTS = process.env.SHOTS_DIR;
const BELL = /new contacts|new contact|جهات اتصال جديدة|جهة اتصال جديدة|جهتا/i;

test.describe("new-contacts bell", () => {
  test("a new contact shows a badge, the list shows it, opening clears it @smoke", async ({ page }) => {
    const { user, card } = await publishedCardFor({ fields: { name: "Layla Hassan" } });
    await signIn(page, user);
    await page.goto("/app/cards");
    const bell = page.getByRole("button", { name: /New contacts$/ });
    await expect(bell).toBeVisible();
    // Nothing yet: no badge.
    await expect(page.getByRole("button", { name: /new contact/ })).toHaveCount(0);

    expect((await createLead(card.public_code, { name: "Vic Visitor" })).status).toBe(201);
    // The bell asks again when the window gets focus.
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    const withCount = page.getByRole("button", { name: "1 new contact" });
    await expect(withCount).toBeVisible();
    await expect(withCount).toHaveText("1");
    await expect(page.getByRole("status").filter({ hasText: "1 new contact" })).toHaveCount(1);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/badge-${test.info().project.name}.png` });

    await withCount.click();
    const dialog = page.getByRole("dialog", { name: "New contacts" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Vic Visitor shared their details")).toBeVisible();
    await expect(dialog.getByText("See all contacts")).toBeVisible();
    // The badge went away while the list stays readable.
    await expect(page.getByRole("button", { name: "1 new contact" })).toHaveCount(0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/open-${test.info().project.name}.png` });

    // Escape closes and returns focus to the bell.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    // Still cleared after a reload: it is kept on the server.
    await page.reload();
    await expect(page.getByRole("button", { name: /New contacts$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /1 new contact/ })).toHaveCount(0);
  });

  test("visiting the contacts page clears the badge", async ({ page }) => {
    const { user, card } = await publishedCardFor();
    await createLead(card.public_code, { name: "Wanda Visitor" });
    await signIn(page, user);
    await page.goto("/app/cards");
    await expect(page.getByRole("button", { name: "1 new contact" })).toBeVisible();
    await page.getByRole("link", { name: /Contacts|My contacts/ }).first().click();
    await expect(page).toHaveURL(/\/app\/contacts/);
    await expect(page.getByRole("button", { name: /1 new contact/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: BELL })).toBeVisible();
  });
});

for (const [lang, w] of [["en", 1280], ["en", 390], ["ar", 1280], ["ar", 390]] as const) {
  test(`screenshots ${lang} ${w}`, async ({ browser }) => {
    test.skip(!SHOTS, "set SHOTS_DIR");
    const { user, card } = await publishedCardFor({ fields: { name: "Layla Hassan" } });
    await createLead(card.public_code, { name: lang === "ar" ? "ماجد الخليفي" : "Maged Khalifa" });
    await createLead(card.public_code, { name: "Sara Visitor", email: "sara@example.com" });
    const ctx = await browser.newContext({ viewport: { width: w, height: 800 }, locale: lang === "ar" ? "ar" : "en-US" });
    await ctx.addCookies([{ name: "bench_lang", value: lang, url: process.env.E2E_WEB_URL! }]);
    const page = await ctx.newPage();
    await signIn(page, user);
    await page.goto("/app/cards");
    await expect(page.locator("button[aria-haspopup=dialog][class*=LeadBell]")).toHaveAttribute("aria-label", lang === "ar" ? /جهتا/ : /2 new contacts/);
    await page.screenshot({ path: `${SHOTS}/${lang}-${w}-badge.png` });
    await page.locator("button[aria-haspopup=dialog][class*=LeadBell]").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/${lang}-${w}-open.png` });
    await ctx.close();
  });
}
