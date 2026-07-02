import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Post-deploy proof for triage demo signal gaps (S1–S3) + LLM payload safety.
 * Requires production demo Case create: DEMO_CASE_CREATE_ENABLED=true.
 *
 * Screenshots: test-results/triage-signal-gaps/*.png
 */
const SCREENSHOT_DIR = path.join(
  process.cwd(),
  "test-results",
  "triage-signal-gaps"
);

interface OrchestrationSnapshot {
  workflowId: string;
  status: string;
  node?: string;
  triage?: { summary?: string; recommendedPriority?: string };
  customerContext?: {
    eligible?: boolean;
    package?: {
      repeatIncident?: {
        value?: { repeat?: boolean; count?: number; windowDays?: number };
        evidenceBasis?: string;
      };
      installedAssets?: {
        value?: { totalAssets?: number; primaryModel?: string };
        evidenceBasis?: string;
      };
      businessRisk?: { evidenceBasis?: string };
    };
  };
  knowledgeGuidance?: {
    eligible?: boolean;
    eligibilityReason?: string;
    status?: string;
    degraded?: boolean;
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

async function createBatteryDemoWorkflow(page: Page): Promise<string> {
  await page.goto("/demo/case-create");
  await expect(
    page.getByRole("heading", { name: /Create a live Salesforce Case/i })
  ).toBeVisible({ timeout: 30_000 });
  await shot(page, "01-demo-case-create");

  await page.getByLabel("Scenario").selectOption("same-day-battery-fix");
  await page
    .getByRole("button", { name: /Create case & step through/i })
    .click();

  await page.waitForURL(/\/orchestration\/stepped\?workflowId=wf-/i, {
    timeout: 120_000
  });
  const workflowId = new URL(page.url()).searchParams.get("workflowId");
  expect(workflowId).toMatch(/^wf-/);
  await expect(page.getByText(/Operator sign-in required/i)).not.toBeVisible();
  await shot(page, "02-stepped-bootstrap");
  return workflowId!;
}

test.describe("Triage demo signal gaps (deployed)", () => {
  test("S1–S3 + LLM safety on live battery demo workflow", async ({ page }) => {
    test.setTimeout(300_000);

    const workflowId = await test.step("bootstrap demo Case + stepped workflow", () =>
      createBatteryDemoWorkflow(page)
    );

    const triageReady = await test.step(
      "S1 prep — triage completes and pauses before Knowledge",
      async () => {
        const snapshot = await pollSnapshot(
          page,
          workflowId,
          (s) =>
            s.status === "awaiting_step" &&
            s.node === "knowledge" &&
            Boolean(s.triage?.summary)
        );
        await shot(page, "03-triage-complete");
        expect(snapshot.triage?.summary?.length).toBeGreaterThan(10);
        return snapshot;
      }
    );

    await test.step("S2 — asset-scoped repeat evidence (API, no raw Case JSON)", () => {
      const evidence =
        triageReady.customerContext?.package?.repeatIncident?.evidenceBasis ??
        "";
      expect(evidence).toMatch(/same asset|account/i);
      expect(evidence).toContain("excluding current Case");
      expect(evidence).not.toMatch(/\{.*"records"/);

      const repeatValue = JSON.stringify(
        triageReady.customerContext?.package?.repeatIncident?.value ?? {}
      );
      expect(repeatValue).not.toContain("CaseNumber");
      expect(repeatValue).not.toMatch(/500[a-zA-Z0-9]{12,}/);
    });

    await test.step("S3 — stepped Triage UI shows summary and execution trace first", async () => {
      const triageCard = page.getByTestId("stepped-node-triage");
      await expect(
        page.getByTestId("stepped-node-status-triage")
      ).toHaveText("COMPLETED", { timeout: 60_000 });
      await triageCard.locator('[class*="chead"]').click();

      const detail = page.getByTestId("stepped-node-detail-triage");
      await expect(detail.getByTestId("stepped-detail-trace")).toBeVisible();
      await expect(detail.getByTestId("stepped-detail-summary")).toBeVisible();
      await expect(detail.getByText(/battery|ProBook/i).first()).toBeVisible();
      await expect(
        detail.locator("div").filter({ hasText: /^Installed assets$/ })
      ).toHaveCount(0);

      const assets =
        triageReady.customerContext?.package?.installedAssets?.value?.totalAssets;
      expect(typeof assets).toBe("number");
      await shot(page, "04-triage-ui-detail");
    });

    const afterKnowledge = await test.step(
      "S1 — Knowledge runs without missing-tenant skip",
      async () => {
        await page.getByRole("button", { name: /Run Knowledge Base/i }).click();
        await shot(page, "05-knowledge-running");

        const snapshot = await pollSnapshot(
          page,
          workflowId,
          (s) =>
            s.knowledgeGuidance !== undefined &&
            s.knowledgeGuidance.eligibilityReason !==
              "Missing tenant ID for RAG context" &&
            (s.knowledgeGuidance.eligible === true ||
              s.knowledgeGuidance.status === "ANSWERED" ||
              s.knowledgeGuidance.status === "NO_SOURCE")
        );
        await shot(page, "06-knowledge-complete");

        expect(snapshot.knowledgeGuidance?.eligibilityReason).not.toBe(
          "Missing tenant ID for RAG context"
        );
        expect(snapshot.knowledgeGuidance?.eligible).not.toBe(false);
        return snapshot;
      }
    );

    await test.step("LLM safety — orchestrator snapshot is structured signals only", () => {
      const serialized = JSON.stringify(afterKnowledge);
      expect(serialized).not.toContain('"records"');
      expect(serialized).not.toMatch(/"Subject":\s*"/);
      expect(
        afterKnowledge.customerContext?.package?.businessRisk?.evidenceBasis
      ).toBeTruthy();
    });
  });
});
