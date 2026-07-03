import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Playwright coverage for the guided OTP intake assistant at /intake.
 *
 * Local (mocked BFF — starts Next dev with CUSTOMER_INTAKE_ENABLED):
 *   npm run test:e2e:intake --workspace @agentforce/react-chat-window
 *
 * Deployed smoke (requires CUSTOMER_INTAKE_ENABLED on the target host):
 *   PLAYWRIGHT_INTAKE_DEPLOYED=true REACT_CHAT_URL=https://your-host \
 *     npm run test:e2e:intake --workspace @agentforce/react-chat-window
 *
 * The spec mocks BFF routes so the full UI state machine can run without
 * Salesforce OTP email delivery or a live AI API.
 */
const TEST_EMAIL = "ada@corp.com";
const MOCK_TOKEN = "mock-intake-jwt-token";
const ASSET_ID = "02i000000000001";
const CASE_ID = "500000000000001";
const CASE_NUMBER = "00001234";

interface IntakeMockOptions {
  invalidOtp?: boolean;
  noDevices?: boolean;
}

async function fulfillJson(route: Route, status: number, body: unknown) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}

async function mockIntakeBff(page: Page, options: IntakeMockOptions = {}) {
  let turnCount = 0;

  await page.route("**/api/intake/otp/request", async (route) => {
    await fulfillJson(route, 200, { status: "sent" });
  });

  await page.route("**/api/intake/otp/verify", async (route) => {
    if (options.invalidOtp) {
      await fulfillJson(route, 401, {
        error: "invalid_code",
        message: "Invalid or expired code."
      });
      return;
    }
    await fulfillJson(route, 200, {
      accessToken: MOCK_TOKEN,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      subject: "customer-intake-session"
    });
  });

  await page.route("**/api/intake/context", async (route) => {
    if (options.noDevices) {
      await fulfillJson(route, 200, {
        displayName: "Ada Lovelace",
        accountName: "Analytical Engines Ltd",
        devices: [],
        shipTo: { city: "London", state: "LDN", country: "UK" }
      });
      return;
    }
    await fulfillJson(route, 200, {
      displayName: "Ada Lovelace",
      accountName: "Analytical Engines Ltd",
      devices: [
        {
          assetId: ASSET_ID,
          label: "ThinkPad X1",
          product: "ThinkPad"
        }
      ],
      shipTo: { city: "London", state: "LDN", country: "UK" }
    });
  });

  await page.route("**/api/intake/turn", async (route) => {
    turnCount += 1;
    const issueCaptured = turnCount >= 1;
    await fulfillJson(route, 200, {
      reply: issueCaptured
        ? "Thanks — I have enough detail. Pick the affected device below, then review and submit."
        : "Could you tell me a bit more about when the issue started?",
      extracted: issueCaptured
        ? {
            subject: "Screen flickers on startup",
            description:
              "My screen flickers and then goes black when I power on the laptop.",
            priority: "High"
          }
        : {},
      issueCaptured,
      ui: { action: issueCaptured ? "showReview" : "none" },
      readyToSubmit: issueCaptured
    });
  });

  await page.route("**/api/intake/case", async (route) => {
    await fulfillJson(route, 201, {
      caseId: CASE_ID,
      caseNumber: CASE_NUMBER
    });
  });
}

test.describe("OTP intake flow (mocked BFF)", () => {
  test.beforeEach(async ({ page }) => {
    await mockIntakeBff(page);
  });

  test("full happy path through case creation", async ({ page }) => {
    await page.goto("/intake");

    await expect(page.getByLabel("Email address")).toBeVisible();
    await page.getByLabel("Email address").fill(TEST_EMAIL);
    await page.getByRole("button", { name: /send verification code/i }).click();

    await expect(
      page.getByRole("heading", { name: "Enter your code" })
    ).toBeVisible();
    await expect(page.getByText(TEST_EMAIL)).toBeVisible();

    await page.getByLabel("Verification code").fill("123456");
    await page.getByRole("button", { name: /verify and continue/i }).click();

    await expect(
      page.getByRole("heading", { name: /Hi Ada Lovelace/i })
    ).toBeVisible();

    const issueInput = page.getByLabel("Describe your issue");
    await issueInput.fill(
      "My screen flickers and then goes black when I power on the laptop."
    );
    await page.getByRole("button", { name: /^send$/i }).click();

    await expect(
      page.getByText(/pick the affected device below/i)
    ).toBeVisible();
    await expect(page.getByText("ThinkPad X1")).toBeVisible();

    await page.getByRole("button", { name: /review & submit/i }).click();

    await expect(
      page.getByRole("heading", { name: "Review your case" })
    ).toBeVisible();
    await expect(page.getByText("Screen flickers on startup")).toBeVisible();
    await expect(page.getByText("ThinkPad X1")).toBeVisible();
    await expect(page.getByText("London, LDN, UK")).toBeVisible();

    await page.getByRole("button", { name: /create support case/i }).click();

    await expect(page.getByRole("heading", { name: "Case created" })).toBeVisible();
    await expect(
      page.getByText(new RegExp(`support case ${CASE_NUMBER}`, "i"))
    ).toBeVisible();
  });

  test("advances to OTP step even when email is unknown (uniform response)", async ({
    page
  }) => {
    await page.goto("/intake");
    await page.getByLabel("Email address").fill("unknown@example.com");
    await page.getByRole("button", { name: /send verification code/i }).click();

    await expect(
      page.getByRole("heading", { name: "Enter your code" })
    ).toBeVisible();
    await expect(page.getByText("unknown@example.com")).toBeVisible();
  });

  test("shows an error for an invalid OTP code", async ({ page }) => {
    await mockIntakeBff(page, { invalidOtp: true });

    await page.goto("/intake");
    await page.getByLabel("Email address").fill(TEST_EMAIL);
    await page.getByRole("button", { name: /send verification code/i }).click();
    await page.getByLabel("Verification code").fill("000000");
    await page.getByRole("button", { name: /verify and continue/i }).click();

    await expect(
      page.getByText(/invalid or has expired/i)
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Enter your code" })
    ).toBeVisible();
  });

  test("allows review without a device when none are on file", async ({ page }) => {
    await mockIntakeBff(page, { noDevices: true });

    await page.goto("/intake");
    await page.getByLabel("Email address").fill(TEST_EMAIL);
    await page.getByRole("button", { name: /send verification code/i }).click();
    await page.getByLabel("Verification code").fill("123456");
    await page.getByRole("button", { name: /verify and continue/i }).click();

    await page
      .getByLabel("Describe your issue")
      .fill("Keyboard keys stick after a spill.");
    await page.getByRole("button", { name: /^send$/i }).click();
    await expect(
      page.getByText(/pick the affected device below/i)
    ).toBeVisible();
    await expect(page.getByText(/no devices are on file/i)).toBeVisible();

    const reviewButton = page.getByRole("button", { name: /review & submit/i });
    await expect(reviewButton).toBeEnabled();
    await reviewButton.click();

    await expect(
      page.getByRole("heading", { name: "Review your case" })
    ).toBeVisible();
    await expect(page.getByText("Not specified")).toBeVisible();
  });

  test("can navigate back from OTP to email", async ({ page }) => {
    await page.goto("/intake");
    await page.getByLabel("Email address").fill(TEST_EMAIL);
    await page.getByRole("button", { name: /send verification code/i }).click();
    await page.getByRole("button", { name: /use a different email/i }).click();

    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /send verification code/i })
    ).toBeVisible();
  });
});

test.describe("OTP intake (deployed smoke)", () => {
  test.skip(
    () => !process.env.PLAYWRIGHT_INTAKE_DEPLOYED,
    "Set PLAYWRIGHT_INTAKE_DEPLOYED=true to run against a deployed intake host."
  );

  test("intake route is enabled on the target host", async ({ page }) => {
    const response = await page.goto("/intake");
    expect(response?.status()).not.toBe(404);
    await expect(page.getByLabel("Email address")).toBeVisible();
  });
});
