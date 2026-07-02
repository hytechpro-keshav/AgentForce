import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Post-deploy proof for triage priority insight UI.
 * Requires production demo Case create: DEMO_CASE_CREATE_ENABLED=true.
 *
 * Screenshots: test-results/triage-priority-insight/*.png
 */
const SCREENSHOT_DIR = path.join(
  process.cwd(),
  "test-results",
  "triage-priority-insight"
);

interface TriagePriorityFactor {
  id: string;
  label: string;
  weight: number;
}

interface OrchestrationSnapshot {
  workflowId: string;
  status: string;
  node?: string;
  triage?: {
    summary?: string;
    recommendedPriority?: string;
    priorityRationale?: string;
    priorityFactors?: TriagePriorityFactor[];
  };
  customerContext?: {
    package?: {
      businessRisk?: { value?: string };
      strategicAccount?: { value?: boolean };
      openIncidentCount?: { value?: number };
      repeatIncident?: { value?: { repeat?: boolean } };
    };
  };
}

async function shot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, `${name}.png`),
    fullPage: true
  });
}

async function pollSnapshot(
  page: Page,
  workflowId: string,
  predicate: (snapshot: OrchestrationSnapshot) => boolean,
  timeoutMs = 180_000
): Promise<OrchestrationSnapshot> {
  const start = Date.now();
  let last: OrchestrationSnapshot | undefined;
  let lastStatus = 0;
  while (Date.now() - start < timeoutMs) {
    const response = await page.request.get(
      `/api/orchestrator/${encodeURIComponent(workflowId)}`,
      { headers: { accept: "application/json" } }
    );
    lastStatus = response.status();
    if (!response.ok()) {
      await page.waitForTimeout(2500);
      continue;
    }
    last = (await response.json()) as OrchestrationSnapshot;
    if (predicate(last)) {
      return last;
    }
    await page.waitForTimeout(2500);
  }
  throw new Error(
    `Timed out polling workflow ${workflowId}. Last HTTP=${lastStatus} status=${last?.status} node=${last?.node}`
  );
}

async function createDisplayTransferWorkflow(page: Page): Promise<string> {
  const createResponse = await page.request.post("/api/demo/cases", {
    headers: { "content-type": "application/json" },
    data: { scenarioId: "display-transfer" }
  });
  expect(createResponse.ok()).toBeTruthy();
  const created = (await createResponse.json()) as {
    caseId: string;
    salesforceCaseUrl?: string;
  };
  expect(created.caseId).toMatch(/^[a-zA-Z0-9]{15,18}$/);
  expect(created.salesforceCaseUrl).toContain("/lightning/r/Case/");

  const steppedResponse = await page.request.post(
    `/api/orchestrator/case/${encodeURIComponent(created.caseId)}/stepped`,
    {
      headers: { "content-type": "application/json" },
      data: { caseId: created.caseId }
    }
  );
  expect(steppedResponse.ok()).toBeTruthy();
  const stepped = (await steppedResponse.json()) as { workflowId?: string };
  expect(stepped.workflowId).toMatch(/^wf-/);

  await page.goto(
    `/orchestration/stepped?workflowId=${encodeURIComponent(stepped.workflowId!)}`
  );
  await expect(page.getByText(/Operator sign-in required/i)).not.toBeVisible();
  await expect(page.getByText("Orchestrator activated")).toBeVisible();
  await shot(page, "02-stepped-bootstrap");

  await page.getByRole("button", { name: /Run Triage/i }).click();
  await shot(page, "02b-triage-running");

  return stepped.workflowId!;
}

test.describe("Triage priority insight (deployed)", () => {
  test("insight strip, badges, rationale, and donut on display-transfer demo", async ({
    page
  }) => {
    test.setTimeout(300_000);

    const workflowId = await test.step("bootstrap Aptivance display-transfer demo", () =>
      createDisplayTransferWorkflow(page)
    );

    const snapshot = await test.step(
      "wait for triage to complete and pause before Knowledge",
      async () =>
        pollSnapshot(
          page,
          workflowId,
          (s) =>
            s.status === "awaiting_step" &&
            s.node === "knowledge" &&
            Boolean(s.triage?.priorityRationale)
        )
    );

    await test.step("insight UI visible on stepped console", async () => {
      const priority = snapshot.triage?.recommendedPriority ?? "normal";
      const risk =
        snapshot.customerContext?.package?.businessRisk?.value ?? "unknown";
      const repeat = snapshot.customerContext?.package?.repeatIncident?.value
        ?.repeat;

      await page.waitForTimeout(1000);
      await expect(page.getByTestId("triage-insight-rationale")).not.toBeEmpty();
      await expect(
        page.getByTestId(`priority-badge-${priority}`)
      ).toBeVisible();
      await expect(
        page.getByTestId(`priority-badge-${risk}-risk`)
      ).toBeVisible();
      await expect(
        page.getByTestId(`priority-badge-${repeat ? "repeat" : "no-repeat"}`)
      ).toBeVisible();
      await expect(page.getByText(/Missing tenant/i)).not.toBeVisible();
      await shot(page, "03-insight-card");
    });

    await test.step("donut legend matches API priorityFactors", async () => {
      const factors = snapshot.triage?.priorityFactors ?? [];
      expect(factors.length).toBeGreaterThanOrEqual(3);
      const sum = factors.reduce((total, factor) => total + factor.weight, 0);
      expect(Math.abs(sum - 100)).toBeLessThanOrEqual(1);

      const visibleLabels = await page
        .locator("[data-testid^='donut-factor-']")
        .allTextContents();
      const matched = factors.filter((factor) =>
        visibleLabels.some((text) => text.includes(factor.label))
      );
      expect(matched.length).toBeGreaterThanOrEqual(3);
      await shot(page, "04-donut-legend");
    });

    await test.step("API snapshot carries rationale and factors", async () => {
      expect(snapshot.triage?.priorityRationale?.length).toBeGreaterThan(10);
      expect(snapshot.triage?.priorityFactors?.length).toBeGreaterThanOrEqual(3);
    });
  });
});
