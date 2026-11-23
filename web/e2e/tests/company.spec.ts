import { expect, test } from "@playwright/test";
import {
  API_URL, PASSWORD, WEB_URL, addEmployee, api, clearMails, companyFor, createLead, inviteMember, linkTo, localise, publishCard,
  registerUser, signIn, uniqueEmail, waitForMail,
} from "../fixtures";
import { pngBuffer, startReceiver } from "../fixtures/helpers";

test.describe("company workspace", () => {
  test("create a company workspace from the dashboard", async ({ page }) => {
    const user = await registerUser({ tag: "newco" });
    await signIn(page, user);
    await page.goto("/app");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Workspace").selectOption({ label: "+ New company" });
    const dialog = page.getByRole("dialog", { name: "New company" });
    await dialog.getByLabel("Company name").fill("Nile Trading E2E");
    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByLabel("Workspace")).toContainText("Nile Trading E2E");
    const { data } = await api<{ kind: string; name: string }[]>("GET", "me/workspaces", { token: user.access });
    expect(data.some((w) => w.kind === "company" && w.name === "Nile Trading E2E")).toBeTruthy();
  });

  test("brand steps: name, logo upload and colours are saved", async ({ page }) => {
    const { owner, ws } = await companyFor();
    await signIn(page, owner, ws);
    await page.goto("/app/brand");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Company name on cards").fill("Acme Brand E2E");
    await page.getByLabel("Website").fill("https://acme-e2e.example.com");
    await page.locator('input[type="file"]').first().setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: await pngBuffer() });
    await expect(page.getByText("Logo updated")).toBeVisible();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByText("Brand saved")).toBeVisible();

    // Colours step.
    await page.getByLabel("Primary colour code").fill("#0a7d5c");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByText("Brand saved")).toBeVisible();

    const { data } = await api<{ brand: { company_name: string; website: string; logo_url: string | null } }>("GET", `workspaces/${ws}`, { token: owner.access });
    expect(data.brand.company_name).toBe("Acme Brand E2E");
    expect(data.brand.website).toContain("acme-e2e.example.com");
    expect(data.brand.logo_url).toBeTruthy();
  });

  test("invite an employee by email and accept the invitation in a second browser", async ({ page, browser }) => {
    clearMails();
    const { owner, ws } = await companyFor();
    await signIn(page, owner, ws);
    await page.goto("/app/team");
    await page.waitForLoadState("networkidle");
    const email = uniqueEmail("invitee");
    await page.getByLabel("Email addresses").fill(`${email}, Sara Invitee`);
    await page.getByRole("button", { name: "Send invitations" }).click();
    await expect(page.getByRole("main").getByText("1 invitation sent").first()).toBeVisible();

    const mail = await waitForMail(email, /invit|join/i);
    const link = localise(linkTo(mail, "/join/"), WEB_URL);

    const second = await browser.newContext();
    try {
      const guest = await second.newPage();
      await guest.goto(link);
      await guest.getByLabel("Your name").fill("Sara Invitee");
      await guest.getByLabel("Choose a password").fill(PASSWORD);
      await guest.getByRole("button", { name: "Join the team" }).click();
      await expect(guest).toHaveURL(/\/app/);
    } finally {
      await second.close();
    }

    await page.reload();
    await expect(page.getByText("Sara Invitee")).toBeVisible();
    await expect(page.getByText("Active").first()).toBeVisible();
  });

  test("a department template reaches the card of a new employee", async ({ page }) => {
    const { owner, ws } = await companyFor();
    await api("POST", `workspaces/${ws}/departments`, {
      token: owner.access,
      body: { name: "Sales E2E", design: { face: 12, colour: 2 }, items: [{ kind: "Calendly", value: "acme/intro", label: "Book a meeting" }] },
    });
    const dept = (await api<{ id: string; name: string }[]>("GET", `workspaces/${ws}/departments`, { token: owner.access })).data[0];
    const email = uniqueEmail("dept");
    const member = await inviteMember(owner, ws, email, { full_name: "Dana Dept", department_id: dept.id });
    const card = (await api<{ items: { kind: string }[]; design: { face: number } }>("GET", `cards/${member.card_id}`, { token: owner.access })).data;
    expect(card.items.some((i) => i.kind === "Calendly")).toBeTruthy();
    expect(card.design.face).toBe(12);

    await signIn(page, owner, ws);
    await page.goto("/app/departments");
    await expect(page.getByText("Sales E2E")).toBeVisible();
    await expect(page.getByText("1 person")).toBeVisible();
  });

  test("a locked field rule stops the employee changing it", async ({ page, browser }) => {
    const { owner, ws } = await companyFor();
    const employee = await addEmployee(owner, ws, { name: "Eli Employee" });
    await signIn(page, owner, ws);
    await page.goto("/app/fields");
    await page.waitForLoadState("networkidle");
    await page.getByRole("radio", { name: "Job title: Locked" }).check();
    await page.getByRole("button", { name: "Save rules" }).click();
    await expect(page.getByText("All rules saved.").or(page.getByText(/Rules saved/)).first()).toBeVisible();

    await api("PATCH", `cards/${employee.cardId}`, { token: employee.access, body: { title: "Boss" }, expect: [200, 400, 403] });
    const after = (await api<{ title: string }>("GET", `cards/${employee.cardId}`, { token: employee.access })).data;
    expect(after.title).not.toBe("Boss");

    const ctx = await browser.newContext();
    try {
      const emp = await ctx.newPage();
      await signIn(emp, employee, employee.ws);
      await emp.goto(`/app/cards/${employee.cardId}`);
      await expect(emp.getByLabel("Job title")).toBeDisabled();
      await expect(emp.getByText(/Your company sets the job title/)).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test("approval flow: the employee asks, the owner approves and the card changes", async ({ page, browser }) => {
    const { owner, ws } = await companyFor();
    const employee = await addEmployee(owner, ws, { name: "Ada Approval" });
    await api("PATCH", `workspaces/${ws}/field-rules`, { token: owner.access, body: { title: "approval" } });

    const ctx = await browser.newContext();
    try {
      const emp = await ctx.newPage();
      await signIn(emp, employee, employee.ws);
      await emp.goto(`/app/cards/${employee.cardId}`);
      await emp.waitForLoadState("networkidle");
      await emp.getByRole("button", { name: "Request change" }).click();
      await emp.getByLabel("New job title").fill("Head of Sales");
      await emp.getByRole("button", { name: "Send to an admin" }).click();
      await expect(emp.getByText(/waiting for an admin to approve/).first()).toBeVisible();
    } finally {
      await ctx.close();
    }

    await signIn(page, owner, ws);
    await page.goto("/app/fields");
    await page.getByRole("tab", { name: /Approvals/ }).click();
    await expect(page.getByText("Head of Sales")).toBeVisible();
    await page.getByRole("button", { name: "Approve", exact: true }).first().click();
    await expect(page.getByText(/Approved\./)).toBeVisible();

    await expect(async () => {
      const card = (await api<{ title: string }>("GET", `cards/${employee.cardId}`, { token: owner.access })).data;
      expect(card.title).toBe("Head of Sales");
    }).toPass();
  });

  test("bulk action: move several invited people to a department at once", async ({ page }) => {
    const { owner, ws } = await companyFor();
    await api("POST", `workspaces/${ws}/departments`, { token: owner.access, body: { name: "Support E2E" } });
    for (const n of ["Bulk One", "Bulk Two"]) await inviteMember(owner, ws, uniqueEmail("bulk"), { full_name: n });
    await signIn(page, owner, ws);
    await page.goto("/app/team");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Select everyone shown").check();
    await page.getByRole("button", { name: "Move to department" }).click();
    await page.getByRole("dialog").getByRole("combobox").selectOption({ label: "Support E2E" });
    await page.getByRole("button", { name: /Move to department \d/ }).click();
    await expect(page.getByText(/All 2 done\./)).toBeVisible();

    const { data } = await api<{ department_id: string | null }[] | { results: { department_id: string | null }[] }>("GET", `workspaces/${ws}/members`, { token: owner.access });
    const members = Array.isArray(data) ? data : data.results;
    expect(members.filter((m) => m.department_id).length).toBe(2);
  });
});

test.describe("contacts, webhooks and API keys", () => {
  async function companyWithLead() {
    const { owner, ws } = await companyFor();
    const employee = await addEmployee(owner, ws, { name: "Lena Lead" });
    await publishCard(owner, employee.cardId);
    const card = (await api<{ public_code: string }>("GET", `cards/${employee.cardId}`, { token: owner.access })).data;
    await createLead(card.public_code);
    return { owner, ws, employee };
  }

  test("leads: set a status and assign to a team member", async ({ page }) => {
    const { owner, ws, employee } = await companyWithLead();
    await signIn(page, owner, ws);
    await page.goto("/app/contacts");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("Visitor Vic")).toBeVisible();
    await page.getByLabel("Status for Visitor Vic").selectOption({ label: "Contacted" });

    await page.getByLabel("Select all contacts on this page").check();
    await page.getByLabel("Assign selected to").selectOption({ label: employee.name });
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText(/1 contact updated/)).toBeVisible();

    const { data } = await api<{ results: { status: string; assignee: unknown }[] }>("GET", `workspaces/${ws}/leads`, { token: owner.access });
    expect(data.results[0].status).toBe("contacted");
    expect(data.results[0].assignee).toBeTruthy();
  });

  test("webhook: a test event reaches a receiver started by the test", async ({ page }) => {
    const receiver = await startReceiver();
    try {
      const { owner, ws } = await companyFor();
      const hook = await api<{ id: string; secret: string }>("POST", `workspaces/${ws}/webhooks`, {
        token: owner.access,
        body: { url: receiver.url, events: ["lead.created"], name: "E2E receiver" },
      });
      const sent = await api<{ status: string }>("POST", `workspaces/${ws}/webhooks/${hook.data.id}/test`, { token: owner.access });
      expect(sent.data.status).toBe("success");
      await expect.poll(() => receiver.received.length).toBeGreaterThan(0);
      const hit = receiver.received[0];
      expect(hit.method).toBe("POST");
      expect(JSON.parse(hit.body)).toBeTruthy();
      expect(Object.keys(hit.headers).some((h) => /signature/i.test(h))).toBeTruthy();

      await signIn(page, owner, ws);
      await page.goto("/app/settings/integrations");
      await expect(page.getByText(receiver.url)).toBeVisible();
    } finally {
      await receiver.close();
    }
  });

  test("API key: create it in Settings, then call the public API with it", async ({ page }) => {
    const { owner, ws } = await companyFor();
    await signIn(page, owner, ws);
    await page.goto("/app/settings/developers");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "New API key" }).first().click();
    await page.getByLabel("Name").fill("E2E key");
    await page.getByLabel("Read cards").check();
    await page.getByRole("button", { name: "Make key" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Your new API key")).toBeVisible();
    const key = (await dialog.locator("code, input[readonly], .ltr").filter({ hasText: /bnch_live_/ }).first().textContent()) ?? "";
    const secret = /bnch_live_[A-Za-z0-9_-]+/.exec(key)?.[0];
    expect(secret, "the key is shown once in the dialog").toBeTruthy();

    const res = await fetch(`${API_URL.replace(/\/api\/v1$/, "")}/api/public/v1/me`, { headers: { Authorization: `Bearer ${secret}` } });
    expect(res.status).toBe(200);
    const bad = await fetch(`${API_URL.replace(/\/api\/v1$/, "")}/api/public/v1/me`, { headers: { Authorization: "Bearer bnch_live_wrong" } });
    expect(bad.status).toBe(401);
  });
});
