import { execSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { api, companyFor, publishedCardFor, registerUser, signIn } from "../fixtures";

// Needs the same set-up as staff-shortcut.spec.ts: E2E_GRANT_STAFF_CMD, E2E_BACKEND_DIR and the API's DATABASE_URL.
// E2E_SHOTS=<folder> also saves screenshots (1280 px and 390 px).
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

function totp(secret: string): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", base32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

async function staffAdmin(page: Page, path: string) {
  const staff = await registerUser({ tag: "framestaff" });
  // The last-admin rule is part of this test: on this throw-away database nobody else may hold the admin role.
  const python = (grant ?? "").replace(/manage\.py.*$/, "");
  execSync(`${python}manage.py shell -c "from accounts.models import User; User.objects.filter(staff_role='admin').update(staff_role='none')"`, { cwd: backendDir, stdio: "ignore" });
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

test.describe("the staff frame and the screens beside it", () => {
  test("search, menu counts, announcement pickers, switch reasons and the security tab", async ({ page }) => {
    test.skip(!grant || !backendDir, "set E2E_GRANT_STAFF_CMD and E2E_BACKEND_DIR to run this test");
    test.setTimeout(420_000);
    const marker = `Quill${Date.now() % 100000}`;
    const { owner, ws } = await companyFor({ name: `${marker} Works` });
    const { user: cardOwner, card } = await publishedCardFor();
    await api("POST", `public/cards/${card.public_code}/report`, { body: { reason: "spam", note: "looks like spam" } });
    await api("POST", "privacy/export", { token: cardOwner.access, body: {} });

    const me = await staffAdmin(page, "/staff");
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

    // menu counts: one open report and one open data request
    const reports = page.locator(".side nav a", { hasText: "Abuse and safety" });
    const data = page.locator(".side nav a", { hasText: "Data requests" });
    await expect(reports.getByTestId("staff-count-badge")).toHaveText(/^[1-9]/);
    await expect(data.getByTestId("staff-count-badge")).toHaveText(/^[1-9]/);
    if (shots) await page.screenshot({ path: `${shots}/frame-1280-overview.png` });

    // the top-bar search finds a company, opens its page; "/" focuses the box
    const search = page.getByTestId("staff-search-input");
    await page.locator("main").click({ position: { x: 5, y: 300 } });
    await page.keyboard.press("/");
    await expect(search).toBeFocused();
    await search.fill(marker);
    const pop = page.getByTestId("staff-search-pop");
    await expect(pop.getByTestId("staff-search-company")).toContainText(`${marker} Works`);
    if (shots) await page.screenshot({ path: `${shots}/frame-1280-search.png` });
    await pop.getByTestId("staff-search-company").click();
    await expect(page).toHaveURL(new RegExp(`/staff/companies/${ws}`));

    // a person opens in place; Enter without a pick goes to People and cards
    await search.fill(owner.email);
    await pop.getByTestId("staff-search-person").first().click();
    await expect(page.getByRole("dialog")).toContainText(owner.email);
    await page.keyboard.press("Escape");
    await search.fill(marker);
    await expect(pop.getByTestId("staff-search-all")).toBeVisible();
    await search.press("Enter");
    await expect(page).toHaveURL(/\/staff\/people\?q=/);

    // announcements: pickers, live count, e-mail preview, typed SEND
    await page.goto(`/staff/announcements?companies=${ws}`);
    await expect(page.getByTestId("company-picker").getByTestId("chip")).toContainText(`${marker} Works`);
    await expect(page.getByTestId("audience-count")).toContainText("1 company");
    await page.getByLabel("Audience").selectOption("plan");
    await page.getByLabel("Plans").click();
    await page.getByTestId("plan-picker").getByRole("option").first().click();
    await expect(page.getByTestId("plan-picker").getByTestId("chip")).toHaveCount(1);
    await expect(page.getByTestId("audience-count")).toContainText(/companies? will see the banner/);
    await page.getByLabel("Audience").selectOption("companies");
    await page.getByLabel("Title (English)").fill("Planned maintenance");
    await page.getByLabel("Text (English)").fill("We pause the service on Sunday at 02:00.");
    await page.getByLabel("العنوان (بالعربية)").fill("صيانة مجدولة");
    await page.getByLabel("النص (بالعربية)").fill("نوقف الخدمة يوم الأحد.");
    await page.getByLabel("Send an e-mail").check();
    await page.getByLabel(/E-mail is a/).selectOption("transactional");
    await expect(page.getByTestId("audience-count")).toContainText("will get the e-mail");
    const frame = page.frameLocator("iframe[title='E-mail preview']");
    await expect(frame.locator("body")).toContainText("We pause the service on Sunday");
    if (shots) await page.screenshot({ path: `${shots}/frame-1280-announce.png`, fullPage: true });
    await page.getByTestId("email-preview").scrollIntoViewIfNeeded();
    if (shots) await page.screenshot({ path: `${shots}/frame-1280-email-preview.png` });
    await page.getByRole("button", { name: "Publish and schedule" }).click();
    const send = page.getByRole("dialog").getByRole("button", { name: "Send", exact: true });
    await expect(send).toBeDisabled();
    await page.getByRole("dialog").getByLabel(/Type SEND/).fill("SEND");
    await expect(send).toBeEnabled();
    await send.click();
    await expect(page.getByRole("table")).toContainText("Planned maintenance");

    // feature switches: company chips and a reason that shows in the history
    await page.goto("/staff/flags");
    const card1 = page.getByRole("region", { name: "directory" });
    // a run that was cut short may have left the switch off: start from "on"
    if (await card1.getByRole("button", { name: "Off", exact: true }).isDisabled()) {
      await card1.getByRole("button", { name: "On", exact: true }).click();
      await page.getByRole("dialog").getByLabel(/Reason/).fill("Reset before the test");
      await page.getByRole("dialog").getByRole("button", { name: "Change" }).click();
      await expect(card1.getByRole("button", { name: "Off", exact: true })).toBeEnabled();
    }
    await card1.getByLabel("Chosen companies for directory").fill(marker);
    await page.getByRole("option", { name: new RegExp(marker) }).click();
    await expect(card1.getByTestId("chip").filter({ hasText: `${marker} Works` })).toHaveCount(1);
    await card1.getByRole("button", { name: "Save companies" }).click();
    await card1.getByRole("button", { name: "Off", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Change" })).toBeDisabled();
    await dialog.getByLabel(/Reason/).fill("Search is broken until the fix");
    await dialog.getByRole("button", { name: "Change" }).click();
    await expect(page.locator("section", { hasText: "Recent changes" }).getByText(/Search is broken until the fix/).first()).toBeVisible();
    if (shots) await page.screenshot({ path: `${shots}/frame-1280-flags.png`, fullPage: true });
    // put it back on
    await card1.getByRole("button", { name: "On", exact: true }).click();
    await page.getByRole("dialog").getByLabel(/Reason/).fill("Fixed, back on for everyone");
    await page.getByRole("dialog").getByRole("button", { name: "Change" }).click();

    // staff: the Security tab lists this session; the last admin cannot be demoted
    await page.goto("/staff/team");
    await page.getByRole("tab", { name: "Security" }).click();
    await expect(page.getByTestId("security-session").first()).toContainText("This session");
    if (shots) await page.screenshot({ path: `${shots}/frame-1280-security.png`, fullPage: true });
    await page.getByRole("tab", { name: "People" }).click();
    await page.getByLabel(`Role of ${me.email}`).selectOption("support");
    const roleDialog = page.getByRole("dialog");
    await roleDialog.getByLabel(/Reason/).fill("Testing the last admin guard");
    await roleDialog.getByRole("button", { name: "Change role" }).click();
    await expect(roleDialog).toContainText("At least one staff admin is required");
    await page.keyboard.press("Escape");

    // phone: the search is a magnifier that opens a box; no sideways scroll
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/staff");
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await page.getByRole("button", { name: "Open search" }).click();
    await page.getByTestId("staff-search-input").fill(marker);
    await expect(page.getByTestId("staff-search-pop").getByTestId("staff-search-company")).toBeVisible();
    if (shots) await page.screenshot({ path: `${shots}/frame-390-search.png` });
    await page.keyboard.press("Escape");
    const noSideScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(noSideScroll).toBe(true);
    await page.goto(`/staff/announcements?companies=${ws}`);
    await expect(page.getByTestId("audience-count")).toContainText("1 company");
    if (shots) await page.screenshot({ path: `${shots}/frame-390-announce.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
});
