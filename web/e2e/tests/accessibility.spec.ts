import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ARTIFACTS, WEB_URL, companyFor, createCard, publishedCardFor, registerSubscribed, signIn, type TestUser } from "../fixtures";

// Automated accessibility checks (axe-core) on ten key pages, in English (left to right) and Arabic (right to left).
// A violation that is "serious" or "critical" fails the test unless it is in a11y/baseline.json (known problems, listed in
// deploy/ACCESSIBILITY_FINDINGS.md). Each baseline entry is "<page>|<direction>" -> { rule id: most affected elements allowed }.
// A new rule, or more elements than the baseline allows, fails. Moderate and minor findings are only written to the report.
// To accept the current state after a review:  A11Y_UPDATE_BASELINE=1 npx playwright test accessibility

type Baseline = Record<string, Record<string, number>>;
const BASELINE_FILE = path.resolve(__dirname, "..", "a11y", "baseline.json");
const REPORT_FILE = path.join(ARTIFACTS, "a11y-report.json");
const BLOCKING = new Set(["serious", "critical"]);
const update = !!process.env.A11Y_UPDATE_BASELINE;

const baseline: Baseline = existsSync(BASELINE_FILE) ? (JSON.parse(readFileSync(BASELINE_FILE, "utf8")) as Baseline) : {};
const measured: Baseline = {};
const report: Record<string, { id: string; impact: string; nodes: number; help: string; targets: string[] }[]> = {};

async function setDirection(page: Page, dir: "ltr" | "rtl") {
  await page.context().addCookies([{ name: "bench_lang", value: dir === "rtl" ? "ar" : "en", url: WEB_URL }]);
}

async function scan(page: Page, name: string, dir: "ltr" | "rtl") {
  await page.waitForLoadState("networkidle");
  await expect(page.locator("html")).toHaveAttribute("dir", dir);
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const key = `${name}|${dir}`;
  report[key] = result.violations.map((v) => ({
    id: v.id, impact: v.impact ?? "minor", nodes: v.nodes.length, help: v.help, targets: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
  }));
  measured[key] = {};
  for (const v of result.violations) if (BLOCKING.has(v.impact ?? "")) measured[key][v.id] = v.nodes.length;
  if (update) return;
  const allowed = baseline[key] ?? {};
  const fresh = Object.entries(measured[key])
    .filter(([id, nodes]) => nodes > (allowed[id] ?? 0))
    .map(([id, nodes]) => `${id}: ${nodes} elements (baseline allows ${allowed[id] ?? 0})`);
  expect(fresh, `new serious or critical accessibility problems on ${key}`).toEqual([]);
}

test.afterAll(() => {
  mkdirSync(ARTIFACTS, { recursive: true });
  writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
  if (update) {
    const merged = { ...baseline, ...measured };
    const sorted = Object.fromEntries(Object.keys(merged).sort().map((k) => [k, merged[k]]));
    writeFileSync(BASELINE_FILE, JSON.stringify(sorted, null, 2) + "\n");
  }
});

for (const dir of ["ltr", "rtl"] as const) {
  test.describe(`accessibility (${dir})`, () => {
    test(`sign-in page ${dir} @a11y @smoke`, async ({ page }) => {
      await setDirection(page, dir);
      await page.goto("/login");
      await scan(page, "sign-in", dir);
    });

    test(`register page ${dir} @a11y`, async ({ page }) => {
      await setDirection(page, dir);
      await page.goto("/register");
      await scan(page, "register", dir);
    });

    test(`privacy page ${dir} @a11y`, async ({ page }) => {
      await setDirection(page, dir);
      await page.goto("/privacy");
      await scan(page, "privacy", dir);
    });

    test(`public card page ${dir} @a11y`, async ({ page }) => {
      const { card } = await publishedCardFor();
      await setDirection(page, dir);
      await page.goto(`/c/${card.public_code}`);
      await scan(page, "public-card", dir);
    });

    test(`dashboard home, card editor, help centre ${dir} @a11y`, async ({ page }) => {
      const user: TestUser = await registerSubscribed({ tag: "a11y" });
      const card = await createCard(user, user.ws);
      await signIn(page, user);
      await setDirection(page, dir);
      await page.goto("/app");
      await scan(page, "dashboard-home", dir);
      await page.goto(`/app/cards/${card.id}`);
      await scan(page, "card-editor", dir);
      await page.goto("/app/contacts");
      await scan(page, "contacts", dir);
      await page.goto("/app/help");
      await scan(page, "help-centre", dir);
    });

    test(`brand and team pages ${dir} @a11y`, async ({ page }) => {
      const { owner, ws } = await companyFor();
      await signIn(page, owner, ws);
      await setDirection(page, dir);
      await page.goto("/app/brand");
      await scan(page, "brand", dir);
      await page.goto("/app/team");
      await scan(page, "team", dir);
    });
  });
}
