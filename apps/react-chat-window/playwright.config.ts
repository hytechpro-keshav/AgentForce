import { defineConfig, devices } from "@playwright/test";

const deployedBaseURL =
  process.env.REACT_CHAT_URL ??
  process.env.PLAYWRIGHT_BASE_URL ??
  "https://react-chat-window-production.up.railway.app";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 60_000,
  outputDir: "test-results/playwright",
  use: {
    trace: "on",
    video: "on",
    screenshot: "only-on-failure"
  },
  projects: [
    {
      name: "chromium",
      testIgnore: /intake-flow\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: deployedBaseURL
      }
    }
  ]
});
