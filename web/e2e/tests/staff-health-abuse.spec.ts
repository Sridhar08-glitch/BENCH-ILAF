import { execSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { api, companyFor, createCard, publishCard, registerUser, signIn } from "../fixtures";

// Needs the same set-up as staff-people.spec.ts: E2E_GRANT_STAFF_CMD, E2E_BACKEND_DIR and the API's DATABASE_URL.
// E2E_SEED_CMD is a command that runs a python script from stdin against the same database (python manage.py shell).
// E2E_SHOTS=<folder> also saves screenshots at 1280 px and 390 px.
const grant = process.env.E2E_GRANT_STAFF_CMD;
const backendDir = process.env.E2E_BACKEND_DIR;
const seed = process.env.E2E_SEED_CMD;
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
  const staff = await registerUser({ tag: "healthstaff" });
  execSync(`${grant} ${staff.email} admin`, { cwd: backendDir, stdio: "ignore" });
  await signIn(page, staff);
  await page.goto(path);
  await page.locator("section.panel button.btn").first().click();
  const secret = (await page.locator("section.panel code").first().textContent())?.trim() ?? "";
  expect(secret.length).toBeGreaterThan(10);
  await page.locator("section.panel input[autocomplete=one-time-code]").fill(totp(secret));
  await page.locator("section.panel form button.btn").click();
  await page.locator("section.panel button.btn").click();
}

async function shot(page: Page, name: string) {
  if (!shots) return;
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: `${shots}/${name}-1280.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${shots}/${name}-390.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
}

test.describe("staff overview, system health, abuse and analytics", () => {
  test("shows comparisons, queues, report numbers, bulk warnings and monthly retention", async ({ page }) => {
    test.skip(!grant || !backendDir || !seed, "set E2E_GRANT_STAFF_CMD, E2E_BACKEND_DIR and E2E_SEED_CMD to run this test");
    test.setTimeout(300_000);

    // reports of earlier runs stay in the scratch database, so start from an empty queue (the numbers then start at R-00001)
    execSync(seed!, { cwd: backendDir, stdio: ["pipe", "ignore", "inherit"], input: "from staff.models import AbuseReport\nAbuseReport.objects.all().delete()\n" });
    const stamp = Date.now() % 100000;
    const companyName = `Seatly ${stamp} A`;
    const codes: string[] = [];
    for (const letter of ["A", "B", "C"]) {
      const { owner, ws } = await companyFor({ name: `Seatly ${stamp} ${letter}`, seats: 1 });
      const card = await createCard(owner, ws, { name: `Reported Person ${letter}` });
      await publishCard(owner, card.id);
      codes.push(card.public_code);
    }
    for (const code of codes) await api("POST", `public/cards/${code}/report`, { body: { reason: "spam", note: "Looks like an advert" } });
    execSync(seed!, {
      cwd: backendDir, stdio: ["pipe", "ignore", "inherit"],
      // The two failed e-mails, and the three companies set to one paid seat each (they have one person, so they are at the limit).
      // (the shell reads a loop only after an empty line)
      input: `from staff.models import EmailLog\nfrom billing.models import Subscription\nEmailLog.objects.all().delete()\nSubscription.objects.filter(workspace__name__startswith="Seatly ${stamp}").update(seats_total=1)\nfor i in range(2):\n    EmailLog.objects.create(to_email=f'bounce{i}@example.test', subject=f'Failed {i}', status='failed', retry_text='Hello again', error='SMTPError: down')\n\n`,
    });

    await staffAdmin(page, "/staff");

    // overview: comparison hints, the second chart, the customer feed and the seat warning
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await expect(page.getByText("in 4 weeks").first()).toBeVisible();
    await expect(page.getByText(/last week/).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: /Total companies, last 12 weeks/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "What customers did lately" })).toBeVisible();
    await expect(page.getByText(`New company: ${companyName}`)).toBeVisible();
    await expect(page.getByText(/near the seat limit/)).toBeVisible();
    await shot(page, "overview");

    // system health
    await page.goto("/staff/system");
    await expect(page.getByRole("heading", { name: "Work waiting in queues" })).toBeVisible();
    await expect(page.getByText("Typical speed (median)")).toBeVisible();
    await expect(page.getByText("Error rate, last hour")).toBeVisible();
    await expect(page.getByText("By kind of file")).toBeVisible();
    for (const label of ["Card photos", "Logos and brand files", "Data exports", "Design request files"]) await expect(page.getByText(label, { exact: true })).toBeVisible();
    await shot(page, "system-health");
    await page.getByRole("tab", { name: "E-mail" }).or(page.getByRole("button", { name: "E-mail", exact: true })).first().click();
    await expect(page.getByText("Not connected")).toBeVisible();
    const resendAll = page.getByRole("button", { name: /Resend all \(2\)/ });
    await expect(resendAll).toBeEnabled();
    await shot(page, "system-email");
    await resendAll.click();
    await expect(page.getByText("2 of 2 sent again")).toBeVisible();
    await expect(page.getByText("No failed e-mails.")).toBeVisible();

    // abuse: short numbers, search by number, bulk warn
    await page.goto("/staff/abuse");
    await expect(page.getByRole("button", { name: /Open report R-0000\d/ }).first()).toBeVisible();
    await shot(page, "abuse");
    await page.getByRole("searchbox", { name: "Search reports" }).fill("R-00002");
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await page.getByRole("searchbox", { name: "Search reports" }).fill("");
    await expect(page.locator("tbody tr")).toHaveCount(3);
    const boxes = page.getByRole("checkbox", { name: "Select report" });
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    await page.getByRole("button", { name: "Warn owners" }).click();
    const confirm = page.getByRole("button", { name: "Send warnings" });
    await expect(confirm).toBeDisabled();
    await page.getByRole("textbox", { name: /Reason .kept/ }).fill("Please remove the advert text.");
    await shot(page, "abuse-warn");
    await confirm.click();
    await expect(page.getByText("2 of 2 warned")).toBeVisible();
    await page.getByRole("button", { name: "Actioned", exact: true }).click();
    await expect(page.locator("tbody tr")).toHaveCount(2);
    await page.getByRole("button", { name: "Open", exact: true }).click();

    // suspend company needs the typed name
    await page.getByRole("button", { name: /Open report R-/ }).first().click();
    const drawerCompany = ((await page.locator("[role=dialog] a[href^='/staff/companies/']").first().textContent()) ?? "").trim();
    expect(drawerCompany).toContain("Seatly");
    await page.getByRole("button", { name: "Suspend the company" }).click();
    const suspend = page.getByRole("button", { name: "Suspend company", exact: true });
    await page.getByRole("textbox", { name: /Reason .kept/ }).fill("Repeated spam cards");
    await expect(suspend).toBeDisabled();
    await page.locator("input[autocomplete=off]").last().fill(drawerCompany);
    await expect(suspend).toBeEnabled();
    await shot(page, "abuse-suspend-company");
    await page.getByRole("button", { name: "Cancel" }).click();

    // analytics
    await page.goto("/staff/analytics");
    await expect(page.getByText("Views, last 30 days")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Active cards over time" })).toBeVisible();
    await shot(page, "analytics-growth");
    await page.getByRole("button", { name: "Retention", exact: true }).or(page.getByRole("tab", { name: "Retention" })).first().click();
    await expect(page.getByRole("heading", { name: "Retention by month joined" })).toBeVisible();
    await shot(page, "analytics-retention");
  });
});
