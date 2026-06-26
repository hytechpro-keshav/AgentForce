import { expect, test } from "@playwright/test";

/**
 * Post-deploy smoke for the merged Triage UI (Phase C) and live surfaces.
 * Run against production:
 *   REACT_CHAT_URL=https://react-chat-window-production.up.railway.app \
 *     npm run test:e2e --workspace @agentforce/react-chat-window
 */
test.describe("Merged Triage orchestration UI (deployed)", () => {
  test("home page loads", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.ok()).toBeTruthy();
  });

  test("orchestration console mentions merged Node 1 triage copy", async ({
    page
  }) => {
    await page.goto("/orchestration");
    await expect(
      page.getByRole("heading", { name: "Orchestration Console" })
    ).toBeVisible();
    await expect(page.getByText(/Node 1 triage.*customer context/i)).toBeVisible();
    await expect(page.getByText(/Node 2 customer/i)).not.toBeVisible();
  });

  test("stepped console route is reachable", async ({ page }) => {
    await page.goto("/orchestration/stepped");
    await expect(
      page.getByText(/Provide a workflow id or Case id/i)
    ).toBeVisible();
  });

  test("demo case-create page loads for stepped workflow entry", async ({
    page
  }) => {
    await page.goto("/demo/case-create");
    await expect(
      page.getByRole("heading", { name: /Create a live Salesforce Case/i })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /stepped console/i }).first()
    ).toBeVisible();
  });
});

test.describe("AI API health (deployed)", () => {
  test("ai-api live health responds", async ({ request }) => {
    const apiBase =
      process.env.AI_API_BASE_URL ??
      "https://ai-api-production-03f5.up.railway.app";
    const response = await request.get(`${apiBase}/health/live`);
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body).toMatchObject({ status: "ok" });
  });
});
