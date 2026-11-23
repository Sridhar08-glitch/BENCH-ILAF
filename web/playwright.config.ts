import { defineConfig, devices } from "@playwright/test";

// Browser tests. The web app and the API must already be running (see e2e/README.md).
// Locally the installed Chrome is used (E2E_CHANNEL=chrome); on CI `npx playwright install --with-deps chromium` provides the browser.
const webUrl = process.env.E2E_WEB_URL ?? "http://localhost:3100";
const channel = process.env.E2E_CHANNEL || undefined;
const chromePath = process.env.E2E_CHROME_PATH || undefined;

export default defineConfig({
  testDir: "./e2e/tests",
  outputDir: "./e2e/artifacts/results",
  timeout: 90_000,
  // Against `next dev` the first visit of each page compiles it, so give assertions more time there (E2E_EXPECT_TIMEOUT=30000).
  expect: { timeout: Number(process.env.E2E_EXPECT_TIMEOUT ?? 10_000) },
  fullyParallel: false,
  workers: Number(process.env.E2E_WORKERS ?? 1),
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: [
    ["list"],
    ["html", { outputFolder: "./e2e/artifacts/report", open: "never" }],
    ["junit", { outputFile: "./e2e/artifacts/junit.xml" }],
  ],
  use: {
    baseURL: webUrl,
    channel,
    launchOptions: chromePath ? { executablePath: chromePath } : {},
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
    locale: "en-US",
    timezoneId: "UTC",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], channel, viewport: { width: 1280, height: 900 } } }],
  globalTeardown: "./e2e/fixtures/global-teardown.ts",
});
