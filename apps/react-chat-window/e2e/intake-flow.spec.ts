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
 * Salesforce OTP email delivery or a live AI API. Case creation is fully
 * conversational: the model summarizes in chat, the customer confirms in
 * chat, the createCase directive triggers the POST, and the chat announces
 * the case number and keeps going — there is no review/submit screen.
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

  const extracted = {
    subject: "Screen flickers on startup",
    description:
      "Screen flickers and goes black on startup. Started recently; customer reported it via chat.",
    priority: "High"
  };

  await page.route("**/api/intake/turn", async (route) => {
    turnCount += 1;
    if (turnCount === 1) {
      // Model has everything it needs: in-chat summary + confirm ask.
      await fulfillJson(route, 200, {
        reply:
          "Here's what I understood: your screen flickers and then goes black when you power on. Shall I go ahead and create the case?",
        extracted,
        issueCaptured: true,
        ui: { action: "none" },
        readyToSubmit: true
      });
      return;
    }
    // Customer confirmed → the model cues the case create.
    await fulfillJson(route, 200, {
      reply: "Creating your case now…",
      extracted,
      issueCaptured: true,
      ui: { action: "createCase" },
      readyToSubmit: true
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

  test("full conversational happy path through case creation", async ({
    page
  }) => {
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

    // The bot summarizes in chat and asks for confirmation — no review screen.
    await expect(
      page.getByText(/shall I go ahead and create the case\?/i)
    ).toBeVisible();
    // The single registered device is auto-selected and shown inline.
    await expect(page.getByText("ThinkPad X1")).toBeVisible();
    expect(await page.getByRole("button", { name: /review/i }).count()).toBe(0);

    await issueInput.fill("yes please");
    await page.getByRole("button", { name: /^send$/i }).click();

    // The chat announces the created case and keeps the conversation going.
    await expect(page.getByText(`#${CASE_NUMBER}`)).toBeVisible();
    await expect(
      page.getByText(/anything else I can help you with\?/i)
    ).toBeVisible();
    await expect(page.getByLabel("Describe your issue")).toBeEnabled();
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

    await expect(page.getByText(/invalid or has expired/i)).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Enter your code" })
    ).toBeVisible();
  });

  test("creates a case conversationally when no devices are on file", async ({
    page
  }) => {
    await mockIntakeBff(page, { noDevices: true });

    await page.goto("/intake");
    await page.getByLabel("Email address").fill(TEST_EMAIL);
    await page.getByRole("button", { name: /send verification code/i }).click();
    await page.getByLabel("Verification code").fill("123456");
    await page.getByRole("button", { name: /verify and continue/i }).click();

    const issueInput = page.getByLabel("Describe your issue");
    await issueInput.fill("Keyboard keys stick after a spill.");
    await page.getByRole("button", { name: /^send$/i }).click();
    await expect(
      page.getByText(/shall I go ahead and create the case\?/i)
    ).toBeVisible();
    await expect(page.getByText(/no devices are on file/i)).toBeVisible();

    await issueInput.fill("yes go ahead");
    await page.getByRole("button", { name: /^send$/i }).click();

    await expect(page.getByText(`#${CASE_NUMBER}`)).toBeVisible();
    await expect(
      page.getByText(/anything else I can help you with\?/i)
    ).toBeVisible();
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
