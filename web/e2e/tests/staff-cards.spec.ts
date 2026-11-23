import { execSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { api, companyFor, createCard, inviteMember, publishCard, registerSubscribed, signIn, uniqueEmail, waitForMail } from "../fixtures";

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

/** The six digit authenticator code of the current 30 second step (RFC 6238). */
function totp(secret: string): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", base32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

async function staffAdmin(page: Page, path: string) {
  const staff = await registerSubscribed({ tag: "cardsstaff" });
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

test.describe("the card list and the companies list in the staff area", () => {
  test("cards show without typing, filter by status, open a drawer and e-mail the holder on suspend", async ({ page }) => {
    test.skip(!grant || !backendDir, "set E2E_GRANT_STAFF_CMD and E2E_BACKEND_DIR to run this test");
    test.setTimeout(240_000);
    const marker = `Marl${Date.now() % 100000}`;
    const holder = await registerSubscribed({ tag: "holder", name: `${marker} Holder` });
    const live = await createCard(holder, holder.ws, { name: `${marker} Livecard`, title: "Founder" });
    await publishCard(holder, live.id);
    const reported = await registerSubscribed({ tag: "reported", name: `${marker} Reported` });
    const rep = await createCard(reported, reported.ws, { name: `${marker} Reportedcard` });
    await publishCard(reported, rep.id);
    await api("POST", `public/cards/${rep.public_code}/report`, { body: { reason: "spam", note: "looks like spam" } });
    const draftOwner = await registerSubscribed({ tag: "draft", name: `${marker} Draft` });
    await createCard(draftOwner, draftOwner.ws, { name: `${marker} Draftcard` });

    await staffAdmin(page, "/staff/people");
    await expect(page.getByRole("heading", { name: "People and cards" })).toBeVisible();

    // the list is there at once, as rows with a thumbnail
    const rows = page.locator("ul[aria-label=Cards] li");
    await expect(rows.first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^All \(\d+\)$/ })).toBeVisible();
    if (shots) await page.screenshot({ path: `${shots}/cards-1280-default.png` });

    // typing narrows it; the chips carry the counts of that search
    const box = page.getByRole("searchbox", { name: "Global search" });
    await box.fill(marker);
    await expect(rows).toHaveCount(3);
    await expect(page.getByRole("button", { name: "All (3)" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Active (2)" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reported (1)" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Draft (1)" })).toBeVisible();
    await page.getByRole("button", { name: "Reported (1)" }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(`${marker} Reportedcard`);
    await expect(rows.first()).toContainText("Reported (1)");
    await page.getByRole("button", { name: "Draft (1)" }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(`${marker} Draftcard`);
    await page.getByRole("button", { name: /^All \(3\)$/ }).click();
    if (shots) await page.screenshot({ path: `${shots}/cards-1280-search.png` });

    // the drawer shows the holder e-mail and the created date, and suspending e-mails the holder
    await rows.filter({ hasText: `${marker} Livecard` }).getByRole("button").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(holder.email);
    await expect(dialog).toContainText("Created");
    if (shots) await page.screenshot({ path: `${shots}/cards-1280-drawer.png` });
    await dialog.getByRole("button", { name: "Suspend the card" }).click();
    await page.getByRole("dialog").last().locator("textarea, input[type=text]").first().fill("Looks like a fake person");
    await page.getByRole("dialog").last().getByRole("button", { name: "Suspend", exact: true }).click();
    const mailed = await waitForMail(holder.email, /suspended/i);
    expect(mailed.body).toContain("Looks like a fake person");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Suspended (1)" })).toBeVisible();

    // phone layout
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(rows.first()).toBeVisible();
    const noSideScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(noSideScroll).toBe(true);
    if (shots) await page.screenshot({ path: `${shots}/cards-390-list.png` });
  });

  test("companies: cards column, seat warning, select all, export CSV and announce to selected", async ({ page }) => {
    test.skip(!grant || !backendDir, "set E2E_GRANT_STAFF_CMD and E2E_BACKEND_DIR to run this test");
    test.setTimeout(240_000);
    const marker = `Corp${Date.now() % 100000}`;
    const full = await companyFor({ name: `${marker} Full`, seats: 5 });
    await createCard(full.owner, full.ws, { name: "Seat one" });
    for (let i = 0; i < 4; i++) await inviteMember(full.owner, full.ws, uniqueEmail("seat")); // 5 of 5 seats taken
    const roomy = await companyFor({ name: `${marker} Roomy`, seats: 10 });

    await staffAdmin(page, "/staff/companies");
    const box = page.getByRole("searchbox", { name: "Search companies" });
    await box.fill(marker);
    const rows = page.locator("tbody tr");
    await expect(rows).toHaveCount(2);
    const fullRow = rows.filter({ hasText: `${marker} Full` });
    await expect(fullRow).toContainText("5 / 5");
    await expect(fullRow.locator("td").nth(5)).not.toHaveText("0"); // the cards column
    await expect(fullRow.locator("td").nth(4)).toHaveAttribute("title", /90%/);
    await expect(rows.filter({ hasText: `${marker} Roomy` }).locator("td").nth(4)).not.toHaveAttribute("title", /90%/);
    if (shots) await page.screenshot({ path: `${shots}/companies-1280-list.png` });

    // search by the owner name
    await box.fill(`${marker} nothing`);
    await expect(page.getByText("No company matches.")).toBeVisible();
    await box.fill("Olivia Owner");
    await expect(rows.first()).toBeVisible();

    // select all on the page, then export
    await box.fill(marker);
    await expect(rows).toHaveCount(2);
    await page.getByLabel("Select all companies on this page").check();
    await expect(page.getByText("2 selected")).toBeVisible();
    if (shots) await page.screenshot({ path: `${shots}/companies-1280-selected.png` });
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export CSV" }).click()]);
    expect(download.suggestedFilename()).toBe("companies.csv");
    const csv = (await import("node:fs")).readFileSync(await download.path(), "utf8");
    expect(csv).toContain(`${marker} Full`);
    expect(csv).toContain(`${marker} Roomy`);

    // announce to the selected companies
    await page.getByRole("button", { name: "Announce to selected" }).click();
    await expect(page).toHaveURL(/\/staff\/announcements\?companies=/);
    const url = new URL(page.url());
    expect(url.searchParams.get("companies")?.split(",").sort()).toEqual([full.ws, roomy.ws].sort());
    const stored = await page.evaluate(() => window.sessionStorage.getItem("staff-announce-companies"));
    expect((JSON.parse(stored ?? "[]") as string[]).sort()).toEqual([full.ws, roomy.ws].sort());

    // phone layout
    await page.goto("/staff/companies");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator("tbody tr").first()).toBeVisible();
    if (shots) await page.screenshot({ path: `${shots}/companies-390-list.png` });
  });
});
