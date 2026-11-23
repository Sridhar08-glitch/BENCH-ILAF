import { execSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { activatePlan, companyFor, registerUser, signIn } from "../fixtures";

// Needs the same set-up as staff-shortcut.spec.ts: E2E_GRANT_STAFF_CMD, E2E_BACKEND_DIR and the API's DATABASE_URL.
// E2E_SHOTS=<folder> also saves screenshots of the list (1280 px and 390 px).
const grant = process.env.E2E_GRANT_STAFF_CMD;
const backendDir = process.env.E2E_BACKEND_DIR;
const shots = process.env.E2E_SHOTS;

function base32(text: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of text.replace(/[\s=]/g, "").toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** The six digit authenticator code of the current 30 second step (RFC 6238). */
function totp(secret: string): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", base32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

async function staffAdmin(page: Page, path: string) {
  const staff = await registerUser({ tag: "peoplestaff" });
  execSync(`${grant} ${staff.email} admin`, { cwd: backendDir, stdio: "ignore" });
  await signIn(page, staff);
  await page.goto(path);
  await page.locator("section.panel button.btn").first().click();
  const secret = (await page.locator("section.panel code").first().textContent())?.trim() ?? "";
  expect(secret.length).toBeGreaterThan(10);
  await page.locator("section.panel input[autocomplete=one-time-code]").fill(totp(secret));
  await page.locator("section.panel form button.btn").click();
  await page.locator("section.panel button.btn").click();
  return staff;
}

test.describe("the people list in the staff area", () => {
  test("lists everyone without typing, filters, pages and opens a person", async ({ page }) => {
    test.skip(!grant || !backendDir, "set E2E_GRANT_STAFF_CMD and E2E_BACKEND_DIR to run this test");
    test.setTimeout(240_000);
    const marker = `Zelda${Date.now() % 100000}`;
    const special = await registerUser({ tag: "zelda", name: `${marker} Pagetest` });
    await activatePlan(special, "personal");
    await companyFor({ name: `${marker} Works` });
    for (let i = 0; i < 27; i++) await registerUser({ tag: `bulk${i}`, name: `Bulk Person ${i}` });

    await staffAdmin(page, "/staff/people");
    await expect(page.getByRole("heading", { name: "People and cards" })).toBeVisible();

    // the list is there at once, without a single key pressed
    const table = page.locator("table");
    await expect(table.locator("tbody tr").first()).toBeVisible();
    await expect(table.locator("tbody tr")).toHaveCount(25);
    const range = page.getByRole("status").filter({ hasText: /of \d+/ });
    await expect(range).toContainText(/^1-25 of \d+$/);
    await expect(page.getByRole("button", { name: "Previous", exact: true })).toBeDisabled();
    if (shots) await page.screenshot({ path: `${shots}/people-1280-list.png` });

    // paging
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(range).toContainText(/^26-\d+ of \d+$/);
    await expect(page.getByRole("button", { name: "Previous", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Previous", exact: true }).click();
    await expect(range).toContainText(/^1-25 of \d+$/);

    // typing narrows the same list; clearing brings everyone back
    const box = page.getByRole("searchbox", { name: "Global search" });
    await box.fill(marker);
    await expect(range).toContainText("1-2 of 2"); // the person and the owner of the company that carries the marker
    await expect(table.locator("tbody tr").filter({ hasText: `${marker} Pagetest` })).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "Companies" })).toBeVisible();
    await expect(table.locator("tbody tr").filter({ hasText: "Live" }).first()).toBeVisible();
    if (shots) await page.screenshot({ path: `${shots}/people-1280-search.png` });
    await box.fill("");
    await expect(range).toContainText(/^1-25 of \d+$/);

    // a filter on the plan works
    await page.getByLabel("Plan", { exact: true }).selectOption("none");
    await expect(range).toContainText(/of \d+$/);
    await expect(table.locator("tbody tr").filter({ hasText: `${marker} Pagetest` })).toHaveCount(0);
    await page.getByRole("button", { name: "Clear filters" }).click();

    // a row opens the person page
    await box.fill(marker);
    await expect(table.locator("tbody tr").filter({ hasText: `${marker} Pagetest` })).toHaveCount(1);
    await table.locator("tbody tr").filter({ hasText: `${marker} Pagetest` }).getByRole("button").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(special.email);
    await page.keyboard.press("Escape");

    // phone layout: one card per person
    await box.fill("");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator("ul[aria-label=People] li").first()).toBeVisible();
    await expect(table).toBeHidden();
    const noSideScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(noSideScroll).toBe(true);
    if (shots) await page.screenshot({ path: `${shots}/people-390-list.png` });
    await page.locator("ul[aria-label=People] li").first().getByRole("button").click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });
});
