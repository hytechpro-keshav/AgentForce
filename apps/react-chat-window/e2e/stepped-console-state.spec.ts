import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Multi-node stepped console state regression.
 * Catches DONE nodes whose execution trace still shows RUNNING on SEQ rows,
 * and orchestrator sidebar / activity coherence after advancing past Triage.
 */
const SCREENSHOT_DIR = path.join(
  process.cwd(),
  "test-results",
  "stepped-console-state"
);

interface OrchestrationSnapshot {
  workflowId: string;
  status: string;
  node?: string;
  triage?: { summary?: string };
  knowledgeGuidance?: {
    status?: string;
    answer?: { safeSummary?: string };
  };
  partsLogistics?: { status?: string };
}

function knowledgeStageSettled(snapshot: OrchestrationSnapshot): boolean {
  const kg = snapshot.knowledgeGuidance;
  if (!kg) return false;
  if (kg.status === "ANSWERED" || kg.status === "NO_SOURCE") return true;
  return Boolean(kg.answer?.safeSummary);
}

function partsStageSettled(snapshot: OrchestrationSnapshot): boolean {
  const parts = snapshot.partsLogistics;
  if (!parts) return false;
  return Boolean(parts.status);
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
  while (Date.now() - start < timeoutMs) {
    const response = await page.request.get(
      `/api/orchestrator/${encodeURIComponent(workflowId)}`,
      { headers: { accept: "application/json" } }
    );
    if (response.ok()) {
      last = (await response.json()) as OrchestrationSnapshot;
      if (predicate(last)) return last;
    }
    await page.waitForTimeout(2500);
  }
  throw new Error(
    `Timed out polling ${workflowId}. status=${last?.status} node=${last?.node}`
  );
}

async function waitNodeDone(page: Page, nodeId: string, timeoutMs = 120_000) {
  await expect(page.getByTestId(`stepped-node-status-${nodeId}`)).toHaveText(
    "COMPLETED",
    { timeout: timeoutMs }
  );
}

async function assertDoneNodeTraceNotRunning(page: Page, nodeId: string) {
  const detail = page.getByTestId(`stepped-node-detail-${nodeId}`);
  await expect(detail).toBeVisible();
  const trace = detail.getByTestId("stepped-detail-trace");
  await expect(trace).toBeVisible();
  const runningBadges = trace.locator('[data-testid="stepped-trace-step-status"]').filter({
    hasText: /^running$/i
  });
  await expect(runningBadges).toHaveCount(0);
}

async function bootstrapAndFinishTriage(page: Page): Promise<string> {
  const createResponse = await page.request.post("/api/demo/cases", {
    headers: { "content-type": "application/json" },
    data: { scenarioId: "display-transfer" }
  });
  expect(createResponse.ok()).toBeTruthy();
  const created = (await createResponse.json()) as { caseId: string };

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
  await page.getByRole("button", { name: /Run Triage/i }).click();

  await pollSnapshot(
    page,
    stepped.workflowId!,
    (s) =>
      s.status === "awaiting_step" &&
      s.node === "knowledge" &&
      Boolean(s.triage?.summary)
  );

  await waitNodeDone(page, "triage");
  await shot(page, "01-triage-done");
  return stepped.workflowId!;
}

test.describe("Stepped console multi-node state (deployed)", () => {
  test("done nodes show settled trace statuses after advancing Knowledge and Parts", async ({
    page
  }) => {
    test.setTimeout(420_000);

    const workflowId = await test.step("bootstrap and finish triage", () =>
      bootstrapAndFinishTriage(page)
    );

    await test.step("advance Knowledge Base and wait for DONE", async () => {
      await page.getByRole("button", { name: /Run Knowledge Base/i }).click();
      await pollSnapshot(
        page,
        workflowId,
        (s) =>
          s.status === "awaiting_step" &&
          s.node === "parts_logistics" &&
          knowledgeStageSettled(s)
      );
      await waitNodeDone(page, "knowledge");
      await shot(page, "02-knowledge-done");
    });

    await test.step("knowledge trace must not show RUNNING when node is DONE", async () => {
      await assertDoneNodeTraceNotRunning(page, "knowledge");
    });

    await test.step("advance Parts & Logistics and wait for DONE", async () => {
      await page.getByRole("button", { name: /Run Parts/i }).click();
      await pollSnapshot(
        page,
        workflowId,
        (s) =>
          s.status === "awaiting_step" &&
          s.node === "scheduling" &&
          partsStageSettled(s)
      );
      await waitNodeDone(page, "parts_logistics");
      await shot(page, "03-parts-done");
    });

    await test.step("parts trace must not show RUNNING when node is DONE", async () => {
      await assertDoneNodeTraceNotRunning(page, "parts_logistics");
    });

    await test.step("orchestrator sidebar shows awaiting next, not receiving", async () => {
      await expect(page.getByText("Awaiting Next ▸")).toBeVisible();
      await expect(page.getByText("Receiving ←")).not.toBeVisible();
      await shot(page, "04-orchestrator-ready");
    });

    await test.step("triage accordion still shows confidence chart when expanded", async () => {
      const triageNode = page.getByTestId("stepped-node-triage");
      await triageNode.click();
      await expect(page.getByTestId("triage-confidence-chart")).toBeVisible({
        timeout: 15_000
      });
      await assertDoneNodeTraceNotRunning(page, "triage");
      await shot(page, "05-triage-expanded");
    });
  });
});
