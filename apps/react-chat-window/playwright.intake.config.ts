import { defineConfig, devices } from "@playwright/test";

const intakeLocalBaseURL =
  process.env.PLAYWRIGHT_INTAKE_BASE_URL ?? "http://localhost:4173";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /intake-flow\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 60_000,
  outputDir: "test-results/playwright",
  use: {
    baseURL: intakeLocalBaseURL,
    trace: "on",
    video: "on",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"]
  },
  webServer: {
    command:
      "CUSTOMER_INTAKE_ENABLED=true AI_API_BASE_URL=http://127.0.0.1:3999 npm run dev",
    url: `${intakeLocalBaseURL}/intake`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
