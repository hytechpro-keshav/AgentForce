import { expect, test } from "@playwright/test";

/**
 * Landing page parity smoke — compares /landing against Ablypro Landing.html content.
 *
 * Deployed:
 *   REACT_CHAT_URL=https://react-chat-window-production.up.railway.app \
 *     npm run test:e2e --workspace @agentforce/react-chat-window -- e2e/landing-page.spec.ts
 *
 * Local:
 *   PLAYWRIGHT_BASE_URL=http://localhost:4173 npm run test:e2e --workspace @agentforce/react-chat-window -- e2e/landing-page.spec.ts
 */

/** Key copy preserved from Ablypro Landing.html — used as parity anchors. */
const REFERENCE_COPY = [
  "The Service Command Center for the products that keep the world running.",
  "Ablypro turns fractured, manual after-sales operations into one connected engine",
  "Great products.",
  "Fractured service.",
  "One connected engine, five pillars.",
  "The Ablypro approach",
  "one nervous system",
  "VoltEdge",
  "Why Ablypro",
  "SOC 2 Type II",
  "ISO 27001",
  "Book a service audit",
  "© 2026 Ablypro · Confidential"
] as const;

const SECTION_IDS = [
  "top",
  "problem",
  "platform",
  "approach",
  "results",
  "case",
  "security",
  "company",
  "contact"
] as const;

const PILLAR_TABS = ["Support", "Field", "Repair", "Parts", "Recovery"] as const;

test.describe("Ablypro landing page (/landing)", () => {
  test.beforeEach(async ({ page }) => {
    const response = await page.goto("/landing");
    expect(response?.ok()).toBeTruthy();
    await page.waitForLoadState("networkidle");
  });

  test("page title matches HTML reference", async ({ page }) => {
    await expect(page).toHaveTitle(/Ablypro.*Service Command Center/i);
  });

  test("logo and hero dashboard card render", async ({ page }) => {
    await expect(page.locator('img[alt="AblyPro"]').first()).toBeVisible();
    await expect(page.getByText("Service Command Center").first()).toBeVisible();
    await expect(page.getByText("LIVE", { exact: true })).toBeVisible();
  });

  test("all reference copy from HTML is present", async ({ page }) => {
    for (const text of REFERENCE_COPY) {
      await expect(page.getByText(text, { exact: false }).first()).toBeVisible();
    }
  });

  test("all nine sections are reachable via anchor ids", async ({ page }) => {
    for (const id of SECTION_IDS) {
      const section = page.locator(`#${id}`);
      await section.scrollIntoViewIfNeeded();
      await expect(section).toBeVisible();
    }
  });

  test("fixed nav links match HTML structure", async ({ page }) => {
    const navLabels = [
      "Platform",
      "Approach",
      "Results",
      "Case study",
      "Security",
      "Book a service audit"
    ];
    for (const label of navLabels) {
      await expect(page.getByRole("link", { name: label }).first()).toBeVisible();
    }
  });

  test("five-pillar tab switcher cycles through all pillars", async ({ page }) => {
    await page.locator("#platform").scrollIntoViewIfNeeded();

    for (const pillar of PILLAR_TABS) {
      await page.getByRole("button", { name: new RegExp(pillar) }).click();
      await expect(
        page.locator("#platform").getByText(pillar, { exact: true }).first()
      ).toBeVisible();
    }
  });

  test("pillar tabs auto-rotate after interval", async ({ page }) => {
    await page.locator("#platform").scrollIntoViewIfNeeded();
    await expect(page.getByText("Every channel, one case queue.")).toBeVisible();

    await page.waitForTimeout(5500);

    await expect(page.getByText("The right tech, arriving prepared.")).toBeVisible();
  });

  test("metric count-up section shows target values after scroll", async ({
    page
  }) => {
    await page.locator("#results").scrollIntoViewIfNeeded();
    await page.waitForTimeout(1200);

    await expect(page.getByText("55%", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("85%", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("92%", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("7 hrs", { exact: false }).first()).toBeVisible();
  });

  test("compliance cert strip matches HTML", async ({ page }) => {
    const certs = [
      "SOC 2 Type II",
      "ISO 27001",
      "ISO 9001",
      "NIST SP 800-88",
      "NAID AAA",
      "R2v3"
    ];
    for (const cert of certs) {
      await expect(page.getByText(cert, { exact: true }).first()).toBeVisible();
    }
  });

  test("problem cards section has all six pain points", async ({ page }) => {
    await page.locator("#problem").scrollIntoViewIfNeeded();
    const problems = [
      "Cases arrive from everywhere",
      "Warranty data is scattered",
      "Skilled people do low-value work",
      "Dispatch is a manual puzzle",
      "Repairs & returns lose value",
      "Leadership flies blind"
    ];
    for (const problem of problems) {
      await expect(page.getByText(problem)).toBeVisible();
    }
  });

  test("floating chat panel opens with intake email step", async ({ page }) => {
    const configRes = await page.request.get("/api/intake/config");
    const config = (await configRes.json()) as {
      bootstrapAvailable?: boolean;
    };

    const chatFab = page.getByRole("button", { name: "Chat with Ably" });
    await expect(chatFab).toBeVisible();
    await page.evaluate(() => {
      const btn = document.querySelector('button[aria-label="Chat with Ably"]');
      (btn as HTMLButtonElement | null)?.click();
    });

    if (config.bootstrapAvailable) {
      await expect(
        page.getByText(/Connecting to your account/i)
      ).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText("Work email")).not.toBeVisible({
        timeout: 15_000
      });
      await expect(
        page
          .getByText(/registered devices? on your account|what issue are you experiencing/i)
          .first()
      ).toBeVisible({ timeout: 20_000 });
      return;
    }

    await expect(page.getByText("Work email")).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByText(/one-time code to verify your identity/i)
    ).toBeVisible();
  });

  test("scroll progress bar advances on scroll", async ({ page }) => {
    const readProgressWidth = () =>
      page.evaluate(() => {
        const bar = Array.from(document.querySelectorAll("div")).find((el) => {
          const s = (el as HTMLElement).style;
          return s.position === "fixed" && s.top === "0px" && s.height === "3px";
        });
        return bar ? parseFloat((bar as HTMLElement).style.width) : 0;
      });

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(200);
    const widthBefore = await readProgressWidth();

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
    const widthAfter = await readProgressWidth();

    expect(widthAfter).toBeGreaterThan(widthBefore);
  });
});
