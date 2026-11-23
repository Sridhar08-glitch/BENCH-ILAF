import { execSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { api, registerSubscribed, signIn, type TestUser } from "../fixtures";

// Needs the same set-up as staff-shortcut.spec.ts: E2E_GRANT_STAFF_CMD, E2E_BACKEND_DIR and the API's DATABASE_URL.
// E2E_SHOTS=<folder> also saves screenshots of the bell (1280 px and 390 px, English and Arabic).
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

async function staffAdmin(page: Page): Promise<TestUser> {
  const staff = await registerSubscribed({ tag: "alertstaff" });
  execSync(`${grant} ${staff.email} admin`, { cwd: backendDir, stdio: "ignore" });
  await signIn(page, staff);
  await page.goto("/staff/support");
  // first visit: enrol the authenticator, confirm with a code, then leave the recovery codes screen
  await page.getByRole("button", { name: "Set up the authenticator" }).or(page.locator("section.panel button.btn").first()).first().click();
  const secret = (await page.locator("section.panel code").first().textContent())?.trim() ?? "";
  expect(secret.length).toBeGreaterThan(10);
  await page.locator("section.panel input[autocomplete=one-time-code]").fill(totp(secret));
  await page.locator("section.panel form button.btn").click();
  await page.locator("section.panel button.btn").click();
  await expect(page.getByTestId("staff-bell")).toBeVisible();
  return staff;
}

async function ask(customer: TestUser, subject: string) {
  const res = await api<{ id: string }>("POST", "support/tickets", { token: customer.access, body: { category: "bug", subject, body: "Please help me with this." } });
  return res.data.id;
}

test.describe("support alerts in the staff area", () => {
  test("the bell, the menu badge and the tab title follow the waiting requests", async ({ page }) => {
    test.skip(!grant || !backendDir, "set E2E_GRANT_STAFF_CMD and E2E_BACKEND_DIR to run this test");
    test.setTimeout(180_000);
    const customer = await registerSubscribed({ tag: "alertcust" });
    const subject = `Card will not save ${Date.now()}`;
    const ticketId = await ask(customer, subject);

    await staffAdmin(page);
    await page.goto("/staff");
    const count = page.getByTestId("staff-bell-count");
    await expect(count).toBeVisible();
    const before = Number((await count.textContent())?.replace("+", ""));
    expect(before).toBeGreaterThanOrEqual(1);
    await expect(page.locator(".side").getByTestId("staff-support-badge")).toHaveText(String(before));
    await expect(page).toHaveTitle(new RegExp(`^\\(${before}\\) `));

    // the list names the request and opens it
    await page.getByRole("button", { name: /Support alerts/ }).click();
    const item = page.getByRole("dialog").getByRole("link", { name: new RegExp(subject) });
    await expect(item).toBeVisible();
    await expect(item).toContainText("New request");
    if (shots) await page.screenshot({ path: `${shots}/bell-1280-en.png` });
    await item.click();
    await expect(page).toHaveURL(new RegExp(`/staff/support/${ticketId}`));
    // looking at Support with the tab in front: no prefix on the title
    await expect(page).toHaveTitle(/^(?!\(\d+\+?\) )/);

    // answering takes it off the count
    await page.locator("textarea").first().fill("We are on it.");
    await page.getByRole("button", { name: "Send reply" }).click();
    await expect(page.getByText("We are on it.").first()).toBeVisible();
    await page.goto("/staff");
    if (before === 1) await expect(count).toHaveCount(0, { timeout: 15_000 });
    else await expect(count).toHaveText(String(before - 1), { timeout: 15_000 });

    // a new request while the page is open shows up by itself (the page asks every 20 seconds)
    const second = `Second question ${Date.now()}`;
    await ask(customer, second);
    await expect(count).toHaveText(String(before), { timeout: 40_000 });
    await expect(page).toHaveTitle(new RegExp(`^\\(${before}\\) `));
  });

  test("a customer reply counts again and the sound choice is remembered", async ({ page }) => {
    test.skip(!grant || !backendDir, "set E2E_GRANT_STAFF_CMD and E2E_BACKEND_DIR to run this test");
    test.setTimeout(180_000);
    const customer = await registerSubscribed({ tag: "alertcust2" });
    const ticketId = await ask(customer, `Reply case ${Date.now()}`);
    await staffAdmin(page);
    await page.goto(`/staff/support/${ticketId}`);
    await page.locator("textarea").first().fill("First answer.");
    await page.getByRole("button", { name: "Send reply" }).click();
    await expect(page.getByText("First answer.").first()).toBeVisible();
    const first = page.waitForResponse((r) => r.url().includes("staff/support/alerts") && r.ok());
    await page.goto("/staff");
    await first;
    const baseline = (await page.getByTestId("staff-bell-count").count()) ? Number((await page.getByTestId("staff-bell-count").textContent())?.replace("+", "")) : 0;
    await api("POST", `support/tickets/${ticketId}/messages`, { token: customer.access, body: { body: "Still not working." } });
    await expect(page.getByTestId("staff-bell-count")).toHaveText(String(baseline + 1), { timeout: 40_000 });
    await page.getByRole("button", { name: /Support alerts/ }).click();
    await expect(page.getByRole("dialog").getByText("New reply").first()).toBeVisible();

    const sound = page.getByTestId("staff-bell-sound");
    await expect(sound).not.toBeChecked();
    await sound.check();
    await page.reload();
    await page.getByRole("button", { name: /Support alerts/ }).click();
    await expect(page.getByTestId("staff-bell-sound")).toBeChecked();
  });

  test("looks right on a phone and in Arabic", async ({ page }) => {
    test.skip(!grant || !backendDir || !shots, "set E2E_GRANT_STAFF_CMD, E2E_BACKEND_DIR and E2E_SHOTS to run this test");
    test.setTimeout(180_000);
    const customer = await registerSubscribed({ tag: "alertcust3" });
    await ask(customer, `Phone case ${Date.now()}`);
    await staffAdmin(page);
    await page.goto("/staff");
    await expect(page.getByTestId("staff-bell-count")).toBeVisible();
    await page.locator(".side a[href='/staff/support']").first().screenshot({ path: `${shots}/menu-1280-en.png` });
    await page.getByRole("button", { name: /Support alerts/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.screenshot({ path: `${shots}/bell-1280-en-b.png` });
    await page.keyboard.press("Escape");

    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto("/staff");
    await expect(page.getByTestId("staff-bell-count")).toBeVisible();
    await page.screenshot({ path: `${shots}/bar-390-en.png` });
    await page.getByRole("button", { name: /Support alerts/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.screenshot({ path: `${shots}/bell-390-en.png` });
    const box = await page.getByRole("dialog").boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 390).toBeTruthy();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "More" }).click();
    await page.screenshot({ path: `${shots}/more-390-en.png` });

    await page.context().addCookies([{ name: "bench_lang", value: "ar", url: page.url() }]);
    await page.reload();
    await expect(page.getByTestId("staff-bell-count")).toBeVisible();
    await page.getByRole("button", { name: /تنبيهات الدعم/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.screenshot({ path: `${shots}/bell-390-ar.png` });
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/staff");
    await expect(page.getByTestId("staff-bell-count")).toBeVisible();
    await page.getByRole("button", { name: /تنبيهات الدعم/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.screenshot({ path: `${shots}/bell-1280-ar.png` });
    await page.keyboard.press("Escape");
    await page.locator(".side a", { hasText: "Support inbox" }).or(page.locator(".side a[href='/staff/support']")).first().screenshot({ path: `${shots}/menu-1280-ar.png` });
  });
});
