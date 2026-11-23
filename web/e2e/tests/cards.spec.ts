import { expect, test, type Page } from "@playwright/test";
import { API_URL, api, createCard, publishedCardFor, registerSubscribed, signIn, uniqueSlug } from "../fixtures";

/** The editor saves by itself a moment after each change: wait for its "saved" state instead of sleeping. */
async function saved(page: Page) {
  await expect(page.getByText("All changes saved")).toBeVisible();
}

test.describe("building a card", () => {
  test("create a card, fill the profile and add buttons @smoke", async ({ page }) => {
    const user = await registerSubscribed({ tag: "build" });
    await signIn(page, user);
    await page.goto("/app/cards");
    // Clicking before the page has loaded its scripts does nothing, so wait for the page to settle first.
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "New card" }).click();
    await expect(page).toHaveURL(/\/app\/cards\/[0-9a-f-]{36}/);

    await page.getByLabel("Full name").fill("Layla Hassan");
    await page.getByLabel("Job title").fill("Head of Design");
    await page.getByLabel("Company", { exact: true }).fill("Hassan Studio");
    await saved(page);

    await page.getByRole("tab", { name: "Buttons" }).click();
    const paste = page.getByLabel("Paste a link, email or phone number");
    await paste.fill("+974 5555 2222");
    await page.getByRole("button", { name: "Find" }).click();
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await saved(page);

    // The saved values are what the API holds, not just what the screen shows.
    const { data: ws } = await api<{ id: string }[]>("GET", "me/workspaces", { token: user.access });
    const { data: list } = await api<{ results?: { name: string; title: string; company: string; items: { value: string }[] }[] } | { name: string; title: string; company: string; items: { value: string }[] }[]>(
      "GET",
      `workspaces/${ws[0].id}/cards`,
      { token: user.access },
    );
    const cards = Array.isArray(list) ? list : (list.results ?? []);
    expect(cards[0].name).toBe("Layla Hassan");
    expect(cards[0].title).toBe("Head of Design");
    expect(cards[0].items.some((i) => i.value.replace(/\D/g, "").includes("55552222"))).toBeTruthy();
  });

  test("pick a design through the wizard (face, colours, text, below, animation, finish) and publish", async ({ page }) => {
    const user = await registerSubscribed({ tag: "design" });
    const card = await createCard(user, user.ws);
    await signIn(page, user);
    await page.goto(`/app/cards/${card.id}`);
    await page.getByRole("tab", { name: "Design" }).click();

    const steps = page.getByRole("list", { name: "Design steps" });
    // Face
    await expect(page.getByRole("heading", { level: 3 }).first()).toBeVisible();
    await page.getByRole("group").locator("button[aria-pressed]").nth(3).click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    // Colours
    await page.getByRole("group", { name: /colours/i }).locator("button[aria-pressed]").nth(2).click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    // Text
    await expect(steps.getByRole("button").nth(2)).toHaveAttribute("aria-current", "step");
    await page.getByRole("button", { name: "Next", exact: true }).click();
    // Below the card
    await page.getByRole("group").locator("button[aria-pressed]").nth(2).click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    // Animation
    await page.getByRole("group").locator("button[aria-pressed]").nth(2).click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    // Finish
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.getByText("Your design is saved")).toBeVisible();
    await saved(page);

    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(page.getByText("Published", { exact: true }).first()).toBeVisible();

    const { data } = await api<{ state: string; card: { design: { face: number } } }>("GET", `public/cards/${card.public_code}`);
    expect(data.state).toBe("live");
    expect(data.card.design.face).toBeGreaterThan(0);
  });

  test("the guide checklist ticks after the card is published", async ({ page }) => {
    const user = await registerSubscribed({ tag: "guide" });
    const card = await createCard(user, user.ws);
    await signIn(page, user);
    await page.goto("/app");
    const progress = page.locator('[data-guide="getting-started"]').getByText(/\d+ of \d+ done/);
    await expect(progress).toBeVisible();
    const doneBefore = Number(/(\d+) of/.exec((await progress.innerText()) ?? "")?.[1] ?? "0");

    await page.goto(`/app/cards/${card.id}`);
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(page.getByText("Published", { exact: true }).first()).toBeVisible();

    await page.goto("/app");
    await expect(async () => {
      const text = await page.locator('[data-guide="getting-started"]').getByText(/\d+ of \d+ done/).innerText();
      expect(Number(/(\d+) of/.exec(text)?.[1] ?? "0")).toBeGreaterThan(doneBefore);
    }).toPass({ timeout: 15_000 });
  });
});

test.describe("the public card page", () => {
  test("a published card shows its details and saves as a contact @smoke", async ({ page }) => {
    const { card } = await publishedCardFor();
    await page.goto(`/c/${card.public_code}`);
    const cardFace = page.getByRole("button", { name: "Flip card" });
    await expect(cardFace).toContainText(/Layla\s*Hassan/);
    await expect(cardFace).toContainText("Head of Design");
    await expect(page.getByRole("link", { name: "Call mobile" }).first()).toHaveAttribute("href", /tel:\+974/);

    // Save contact opens the phone-style contact sheet with the card's details.
    await page.getByRole("link", { name: "Save contact" }).click();
    await expect(page.getByRole("dialog", { name: "New Contact" })).toBeVisible();
    await expect(page.getByRole("dialog").getByText("Layla").first()).toBeVisible();

    // The contact file itself is a real vCard.
    const res = await page.request.get(`${API_URL}/public/cards/${card.slug}/vcard`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/vcard");
    const text = await res.text();
    expect(text).toContain("BEGIN:VCARD");
    expect(text).toContain("FN:Layla Hassan");
  });

  test("the card flips to its QR code and back", async ({ page }) => {
    const { card } = await publishedCardFor();
    await page.goto(`/c/${card.public_code}`);
    const face = page.locator(".card").first();
    await expect(face).toBeVisible();
    const before = await face.getAttribute("class");
    await face.click({ position: { x: 20, y: 20 } });
    await expect(async () => expect(await face.getAttribute("class")).not.toBe(before)).toPass();
    await face.click({ position: { x: 20, y: 20 } });
    await expect(async () => expect(await face.getAttribute("class")).toBe(before)).toPass();
  });

  test("share your details: the visitor gives consent and the owner gets a contact @smoke", async ({ page, browser }) => {
    const { user, card } = await publishedCardFor();
    await page.goto(`/c/${card.public_code}`);
    await page.getByRole("button", { name: "Share your details" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/Your name/).fill("Visitor Vera");
    await dialog.getByLabel(/^Email/).fill("vera.visitor@example.com");
    await dialog.locator("#lead-consent").check();
    // A form sent faster than a person can type is refused as a bot, so the send is retried until the delay has passed.
    await expect(async () => {
      if (await dialog.getByRole("button", { name: "Send", exact: true }).isVisible()) await dialog.getByRole("button", { name: "Send", exact: true }).click();
      await expect(page.getByText("Thank you")).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 20_000 });

    // The owner sees the contact in the dashboard.
    const owner = await browser.newContext();
    try {
      const ownerPage = await owner.newPage();
      await signIn(ownerPage, user);
      await ownerPage.goto("/app/contacts");
      await expect(ownerPage.getByText("Visitor Vera")).toBeVisible();
    } finally {
      await owner.close();
    }
  });

  test("a form that skips consent is not sent", async ({ page }) => {
    const { card } = await publishedCardFor();
    await page.goto(`/c/${card.public_code}`);
    await page.getByRole("button", { name: "Share your details" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/Your name/).fill("No Consent");
    await dialog.getByLabel(/^Email/).fill("noconsent@example.com");
    await dialog.getByRole("button", { name: "Send", exact: true }).click();
    await expect(dialog.getByText("Please tick the box to agree.")).toBeVisible();
  });

  test("an unknown card address shows the not-found screen", async ({ page }) => {
    await page.goto(`/c/${uniqueSlug("missing")}`);
    await expect(page.getByText("We could not find this card")).toBeVisible();
  });

  test("an unpublished card is not visible to visitors", async ({ page }) => {
    const { user, card } = await publishedCardFor();
    await api("POST", `cards/${card.id}/unpublish`, { token: user.access });
    await page.goto(`/c/${card.public_code}`);
    await expect(page.getByRole("button", { name: "Flip card" })).toHaveCount(0);
  });
});
