import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Post-deploy proof for AI workflow confidence chart (after triage output).
 * Requires production demo Case create: DEMO_CASE_CREATE_ENABLED=true.
 *
 * Screenshots: test-results/triage-workflow-confidence/*.png
 * Video: test-results/playwright (video.webm per test)
 */
const SCREENSHOT_DIR = path.join(
  process.cwd(),
  "test-results",
  "triage-workflow-confidence"
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
    workflowConfidence?: number;
    confidenceFactors?: TriagePriorityFactor[];
    humanInterventionRecommended?: boolean;
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
    `Timed out polling workflow ${workflowId}. Last HTTP=${lastStatus} status=${last?.status} node=${last?.node} confidence=${last?.triage?.workflowConfidence}`
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
  await expect(page.getByText("Agent activated")).toBeVisible();
  await shot(page, "01-stepped-bootstrap");

  await page.getByRole("button", { name: /Run Triage/i }).click();
  await shot(page, "02-triage-running");

  return stepped.workflowId!;
}

test.describe("Triage workflow confidence (deployed)", () => {
  test("confidence chart animates after triage output in 01 Triage accordion", async ({
    page
  }) => {
    test.setTimeout(300_000);

    const workflowId = await test.step("bootstrap display-transfer demo", () =>
      createDisplayTransferWorkflow(page)
    );

    const snapshot = await test.step(
      "wait for triage confidence fields from API",
      async () =>
        pollSnapshot(
          page,
          workflowId,
          (s) =>
            s.status === "awaiting_step" &&
            s.node === "knowledge" &&
            typeof s.triage?.workflowConfidence === "number" &&
            (s.triage.confidenceFactors?.length ?? 0) >= 2
        )
    );

    await test.step("wait for triage UI to finish typing and show DONE", async () => {
      const triageNode = page.getByTestId("stepped-node-triage");
      const detail = page.getByTestId("stepped-node-detail-triage");
      await expect(triageNode.getByText("COMPLETED")).toBeVisible({ timeout: 120_000 });
      await expect(page.getByText("1 / 5")).toBeVisible({ timeout: 30_000 });

      const summary = detail.getByTestId("stepped-detail-summary");
      await expect(summary).toBeVisible({ timeout: 30_000 });
      await expect(async () => {
        const text = (await summary.textContent()) ?? "";
        expect(text.replace(/\u2580|▌/g, "").trim().length).toBeGreaterThan(20);
        await expect(summary.locator('[class*="typeCursor"]')).toHaveCount(0);
      }).toPass({ timeout: 60_000 });
    });

    await test.step("triage accordion shows output then confidence chart", async () => {
      const triageNode = page.getByTestId("stepped-node-triage");
      const detail = page.getByTestId("stepped-node-detail-triage");
      const output = detail.getByTestId("stepped-node-output-triage");
      await expect(output).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("triage-confidence-chart")).toBeVisible({
        timeout: 30_000
      });

      const chartFollowsOutput = await triageNode.evaluate((node) => {
        const outputEl = node.querySelector(
          '[data-testid="stepped-node-output-triage"]'
        );
        const chartEl = node.querySelector(
          '[data-testid="triage-confidence-chart"]'
        );
        if (!outputEl || !chartEl) return false;
        return Boolean(
          outputEl.compareDocumentPosition(chartEl) &
            Node.DOCUMENT_POSITION_FOLLOWING
        );
      });
      expect(chartFollowsOutput).toBe(true);

      const score = detail.getByTestId("triage-confidence-score");
      let sawProgress = false;
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        const text = (await score.textContent()) ?? "0%";
        const value = Number.parseInt(text.replace(/[^\d]/g, ""), 10);
        if (Number.isFinite(value) && value > 0) {
          sawProgress = true;
          break;
        }
        if (text.trim() === "0%") {
          sawProgress = true;
          break;
        }
        await page.waitForTimeout(100);
      }
      expect(sawProgress).toBe(true);

      await shot(page, "03-triage-output-and-chart");
    });

    await test.step("animated score settles at API workflowConfidence", async () => {
      const latest = await pollSnapshot(
        page,
        workflowId,
        (s) => typeof s.triage?.workflowConfidence === "number"
      );
      const confidence = latest.triage!.workflowConfidence!;

      const score = page.getByTestId("triage-confidence-score");
      await expect(score).toContainText(`${confidence}%`, { timeout: 20_000 });
      await shot(page, "04-confidence-score-settled");
    });

    await test.step("verdict and factor legend match snapshot", async () => {
      const latest = await pollSnapshot(
        page,
        workflowId,
        (s) => typeof s.triage?.workflowConfidence === "number"
      );
      const intervention = latest.triage?.humanInterventionRecommended ?? false;
      const verdict = page.getByTestId("triage-confidence-verdict");
      if (intervention) {
        await expect(verdict).toContainText(/Human review recommended/i);
      } else {
        await expect(verdict).toContainText(/AI can likely complete the workflow/i);
      }

      const factors = latest.triage?.confidenceFactors ?? [];
      expect(factors.length).toBeGreaterThanOrEqual(2);
      const sum = factors.reduce((total, factor) => total + factor.weight, 0);
      expect(Math.abs(sum - 100)).toBeLessThanOrEqual(1);

      const matched = await Promise.all(
        factors.map((factor) =>
          page.getByTestId(`confidence-factor-${factor.id}`).isVisible()
        )
      );
      expect(matched.filter(Boolean).length).toBeGreaterThanOrEqual(2);
      await shot(page, "05-confidence-legend");
    });

    await test.step("priority insight strip still present above spine", async () => {
      await expect(page.getByTestId("triage-insight-rationale")).toBeVisible();
      await expect(page.getByTestId("triage-priority-donut")).toBeVisible();
      await shot(page, "06-insight-strip-retained");
    });
  });
});
