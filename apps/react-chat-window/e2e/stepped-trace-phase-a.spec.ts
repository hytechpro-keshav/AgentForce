import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Phase A proof: execution trace first, metadata fields hidden in stepped UI.
 * Requires production demo Case create: DEMO_CASE_CREATE_ENABLED=true.
 *
 * Screenshots: test-results/stepped-trace-phase-a/*.png
 */
const SCREENSHOT_DIR = path.join(
  process.cwd(),
  "test-results",
  "stepped-trace-phase-a"
);

const HIDDEN_LABELS = [
  "Provider",
  "Model",
  "Fallback",
  "Latency",
  "Business risk",
  "Repeat failure",
  "Customer tier",
  "SLA",
  "Warranty",
  "Strategic account",
  "Installed assets",
  "Open incidents",
  "Prior escalations"
];

interface OrchestrationSnapshot {
  workflowId: string;
  status: string;
  node?: string;
  triage?: { summary?: string };
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

async function countVisibleSeqSteps(detail: ReturnType<Page["getByTestId"]>) {
  return detail.locator('[class*="tstep"]').count();
}

async function bootstrapDisplayTransferWorkflow(page: Page): Promise<string> {
  const createResponse = await page.request.post("/api/demo/cases", {
    headers: { "content-type": "application/json" },
    data: { scenarioId: "display-transfer" }
  });
  expect(createResponse.ok()).toBeTruthy();
  const created = (await createResponse.json()) as { caseId: string };
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

  await test.step("running triage shows open live trace with cursor", async () => {
    const triageNode = page.getByTestId("stepped-node-triage");
    const detail = page.getByTestId("stepped-node-detail-triage");
    await expect(triageNode.getByText("RUNNING")).toBeVisible({ timeout: 15_000 });
    await expect(detail).toBeVisible();
    await expect(page.getByText(/Execution trace/i)).toBeVisible();
    await expect(page.getByTestId("stepped-live-trace-cursor")).toBeVisible();
    await expect(detail).not.toContainText(/awaiting Run for Triage/i);

    // During live typing, SEQ rows should appear gradually (at most one new row per frame).
    let maxSeq = 0;
    let sawInstantDump = false;
    for (let frame = 0; frame < 12; frame += 1) {
      await page.waitForTimeout(750);
      await expect(page.getByTestId("stepped-live-trace-cursor")).toBeVisible();
      await expect(detail).not.toContainText(/awaiting Run for Triage/i);
      await expect(page.getByTestId("triage-insight-rationale")).not.toBeVisible();
      const seqCount = await countVisibleSeqSteps(detail);
      if (seqCount > maxSeq + 2) {
        sawInstantDump = true;
      }
      expect(seqCount).toBeGreaterThanOrEqual(maxSeq);
      maxSeq = Math.max(maxSeq, seqCount);
    }
    expect(maxSeq).toBeGreaterThanOrEqual(2);
    expect(sawInstantDump).toBe(false);

    await shot(page, "02-triage-live-trace");
  });

  return stepped.workflowId!;
}

test.describe("Stepped trace Phase A (deployed)", () => {
  test("trace first in accordion and metadata fields hidden", async ({ page }) => {
    test.setTimeout(300_000);

    const workflowId = await test.step("bootstrap display-transfer stepped run", () =>
      bootstrapDisplayTransferWorkflow(page)
    );

    await test.step("wait for triage to finish", async () => {
      await pollSnapshot(
        page,
        workflowId,
        (snapshot) =>
          snapshot.status === "awaiting_step" &&
          snapshot.node === "knowledge" &&
          Boolean(snapshot.triage?.summary)
      );

      const detail = page.getByTestId("stepped-node-detail-triage");
      const triageNode = page.getByTestId("stepped-node-triage");

      // Wait for DONE — trace should finish typing before the badge appears.
      await expect(triageNode.getByText("COMPLETED")).toBeVisible({ timeout: 120_000 });

      // Summary should finish typing (no stuck cursor).
      const summary = detail.getByTestId("stepped-detail-summary");
      await expect(summary).toBeVisible({ timeout: 30_000 });
      await expect(async () => {
        const text = (await summary.textContent()) ?? "";
        expect(text.replace(/\u2580|▌/g, "").trim().length).toBeGreaterThan(20);
        await expect(summary.locator('[class*="typeCursor"]')).toHaveCount(0);
      }).toPass({ timeout: 60_000 });

      const trace = detail.getByTestId("stepped-detail-trace");
      await expect(trace).toContainText("SEQ");
      const seqCount = await countVisibleSeqSteps(trace);
      expect(seqCount).toBeGreaterThanOrEqual(4);

      await shot(page, "03-triage-awaiting-knowledge");
    });

    await test.step("triage accordion shows trace before summary", async () => {
      const triageNode = page.getByTestId("stepped-node-triage");
      await expect(triageNode.getByText("COMPLETED")).toBeVisible();
      const detail = page.getByTestId("stepped-node-detail-triage");
      await expect(detail).toBeVisible();

      const trace = detail.getByTestId("stepped-detail-trace");
      const summary = detail.getByTestId("stepped-detail-summary");
      await expect(trace).toBeVisible();
      await expect(summary).toBeVisible();
      await expect(trace).toHaveText(/Execution trace/i);
      await expect(trace).toHaveText(/SEQ/i);

      const traceBox = await trace.boundingBox();
      const summaryBox = await summary.boundingBox();
      expect(traceBox).toBeTruthy();
      expect(summaryBox).toBeTruthy();
      expect(traceBox!.y).toBeLessThan(summaryBox!.y);

      const output = detail.getByTestId("stepped-node-output-triage");
      await expect(output).toBeVisible({ timeout: 30_000 });
      const followsDetail = await triageNode.evaluate((node) => {
        const detail = node.querySelector(
          '[data-testid="stepped-node-detail-triage"]'
        );
        const outputEl = node.querySelector(
          '[data-testid="stepped-node-output-triage"]'
        );
        if (!detail || !outputEl) return false;
        return Boolean(
          detail.compareDocumentPosition(outputEl) &
            Node.DOCUMENT_POSITION_FOLLOWING
        );
      });
      expect(followsDetail).toBe(true);

      for (const label of HIDDEN_LABELS) {
        await expect(
          detail.locator('[class*="field"], [class*="tf"]').filter({
            hasText: new RegExp(`^${label}$`, "i")
          })
        ).toHaveCount(0);
      }

      await expect(detail.getByText(/gpt-4o-mini/i)).toHaveCount(0);
      await expect(detail.getByText(/^openai$/i)).toHaveCount(0);

      await shot(page, "04-triage-accordion-trace-first");
    });

    await test.step("insight strip still visible above spine", async () => {
      await expect(page.getByTestId("triage-insight-rationale")).toBeVisible();
      await shot(page, "05-insight-strip-retained");
    });
  });
});
