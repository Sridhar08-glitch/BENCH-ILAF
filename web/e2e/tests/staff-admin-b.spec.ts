import { execSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { api, API_URL, companyFor, createCard, publishCard, registerUser, signIn } from "../fixtures";
import { waitForMail } from "../fixtures/mail";

// Needs the same set-up as staff-people.spec.ts: E2E_GRANT_STAFF_CMD, E2E_BACKEND_DIR, the API's DATABASE_URL and E2E_MAIL_DIR.
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
  const staff = await registerUser({ tag: "adminbstaff", name: "Priya Staff" });
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

async function shot(page: Page, name: string) {
  if (!shots) return;
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: `${shots}/${name}-1280.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${shots}/${name}-390.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
}

test.describe("staff admin: company page, support view mail, audit log, applications table", () => {
  test("the whole round", async ({ page }) => {
    test.skip(!grant || !backendDir, "set E2E_GRANT_STAFF_CMD and E2E_BACKEND_DIR to run this test");
    test.setTimeout(300_000);
    const marker = `Quill${Date.now() % 100000}`;
    const { owner, ws } = await companyFor({ name: `${marker} Works`, seats: 10 });
    const card = await createCard(owner, ws, { name: `${marker} Person` });
    await publishCard(owner, card.id);
    const code = (await api<{ public_code: string }>("GET", `cards/${card.id}`, { token: owner.access })).data.public_code;
    for (let i = 0; i < 4; i++) await api("POST", `public/cards/${code}/events`, { body: { type: "view", source: "link", kind: "" } });
    // a request for access with a country, from the public form
    const applicant = `${marker} Applicant`;
    await fetch(`${API_URL}/public/company-leads`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company: `${marker} Applicant Ltd`, name: applicant, email: `${marker.toLowerCase()}@example.com`, size: "6-20", country: "QA", message: "Hello" }),
    });

    await staffAdmin(page, "/staff/applications");

    // ---- applications: table with country and an assignee picker
    await expect(page.getByRole("heading", { name: "Applications and requests" })).toBeVisible();
    const row = page.locator("tbody tr").filter({ hasText: applicant });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Qatar");
    const picker = row.getByRole("combobox", { name: /Assigned to/ });
    await picker.selectOption({ index: 1 });
    await expect(page.getByText("Saved. Logged.").first()).toBeVisible();
    await expect(picker).not.toHaveValue("");
    await shot(page, "applications-table");
    await page.getByRole("button", { name: "Board", exact: true }).click();
    await expect(page.getByRole("region", { name: "new" })).toContainText(applicant);

    // ---- the company page
    await page.goto(`/staff/companies/${ws}`);
    await expect(page.getByRole("heading", { name: `${marker} Works` })).toBeVisible();
    await expect(page.getByRole("region", { name: "Seats" })).toContainText("of 10 used");
    await expect(page.getByRole("progressbar", { name: "Seats used" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Account" })).toContainText(owner.email);
    const chart = page.getByRole("img", { name: "Card views per day, last 14 days" });
    await expect(chart).toBeVisible();
    await expect(chart.locator("rect")).toHaveCount(14);
    await shot(page, "company-overview");
    await page.getByRole("tab", { name: "Team" }).click();
    await expect(page.locator("th", { hasText: "Title" })).toBeVisible();
    await expect(page.locator("th", { hasText: "Card" })).toBeVisible();
    await shot(page, "company-team");
    await page.getByRole("tab", { name: "Brand" }).click();
    await expect(page.getByLabel("Brand colours")).toBeVisible();
    await expect(page.getByText("Card font")).toBeVisible();
    await page.getByRole("tab", { name: "Leads" }).click();
    await expect(page.getByText(/in total/)).toBeVisible();

    // ---- support view: the owner gets an e-mail with who and until when
    await page.getByRole("button", { name: "Open support view" }).click();
    await page.getByPlaceholder(/For example/).fill("The owner asked us to check the team");
    await page.getByRole("button", { name: "Start support view" }).click();
    await expect(page).toHaveURL(/support-view\//);
    const mail = await waitForMail(owner.email, /support/i);
    expect(mail.body).toContain("Priya Staff");
    expect(mail.body).toMatch(/until .* UTC/);
    expect(mail.body).toContain("The owner asked us to check the team");
    await page.getByRole("tab", { name: "Leads" }).click();
    await expect(page.getByRole("tab", { name: "Leads" })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: "What was viewed" }).click();
    await page.getByRole("button", { name: "End session" }).last().click();

    // ---- the audit log: chips, category column, From column, Look entries
    await page.goto("/staff/audit");
    await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();
    for (const chip of ["All", "Look", "Application", "System"]) await expect(page.getByRole("group", { name: "Category" }).getByRole("button", { name: chip, exact: true })).toBeVisible();
    await expect(page.locator("th", { hasText: "Category" })).toBeVisible();
    await expect(page.locator("th", { hasText: "From" }).first()).toBeVisible();
    await expect(page.locator("th", { hasText: "Sign-in address" })).toHaveCount(0);
    await page.getByRole("group", { name: "Category" }).getByRole("button", { name: "Look", exact: true }).click();
    await expect(page.locator("tbody tr").filter({ hasText: "leads" }).first()).toBeVisible();
    await shot(page, "audit-look");
    await page.getByRole("group", { name: "Category" }).getByRole("button", { name: "Application", exact: true }).click();
    await expect(page.locator("tbody tr").filter({ hasText: `${marker} Applicant Ltd` }).first()).toBeVisible();

    // ---- suspend asks to type the company name; the reason goes to the owner
    await page.goto(`/staff/companies/${ws}`);
    await page.getByRole("tab", { name: "Danger zone" }).click();
    await page.getByRole("button", { name: "Suspend the company" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox").first().fill("Repeated chargebacks from this company");
    const confirm = dialog.getByRole("button", { name: "Suspend", exact: true });
    await expect(confirm).toBeDisabled();
    await dialog.getByRole("textbox").nth(1).fill(`${marker} Works`);
    await expect(confirm).toBeEnabled();
    await shot(page, "suspend-dialog");
    await confirm.click();
    await expect(page.getByText(/Suspended/).first()).toBeVisible();
    const suspended = await waitForMail(owner.email, /suspended/i);
    expect(suspended.body).toContain("Repeated chargebacks from this company");
  });
});
