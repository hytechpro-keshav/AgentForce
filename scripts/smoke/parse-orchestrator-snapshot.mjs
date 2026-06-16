#!/usr/bin/env node
/**
 * Safe JSON parse + field access for orchestrator workflow snapshots.
 * Workflow payloads may include control characters in free-text fields that
 * break `jq`; Node's JSON.parse handles them correctly.
 */
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const mode = args[0] ?? "--summary";

function loadSnapshot() {
  const raw = readFileSync(0, "utf8");
  return JSON.parse(raw);
}

function getPath(obj, path) {
  const parts = path.split(".");
  let cur = obj;
  for (const part of parts) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

function formatValue(value) {
  if (value === undefined || value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

const snapshot = loadSnapshot();

if (mode === "--summary") {
  const summary = {
    workflowId: snapshot.workflowId,
    status: snapshot.status,
    triage: snapshot.triage,
    customerContext: snapshot.customerContext
      ? {
          eligible: snapshot.customerContext.eligible,
          degraded: snapshot.customerContext.degraded
        }
      : null,
    knowledgeGuidance: snapshot.knowledgeGuidance
      ? {
          eligible: snapshot.knowledgeGuidance.eligible,
          status: snapshot.knowledgeGuidance.status,
          degraded: snapshot.knowledgeGuidance.degraded,
          sourceCount: snapshot.knowledgeGuidance.answer?.sources?.length ?? 0
        }
      : null,
    partsLogistics: snapshot.partsLogistics
      ? {
          eligible: snapshot.partsLogistics.eligible,
          eligibilityReason: snapshot.partsLogistics.eligibilityReason,
          status: snapshot.partsLogistics.status,
          degraded: snapshot.partsLogistics.degraded,
          fulfillmentReadiness: snapshot.partsLogistics.fulfillmentReadiness,
          partPlans: (snapshot.partsLogistics.partPlans ?? []).map((plan) => ({
            partNumber: plan.partNumber,
            availability: plan.availability,
            exceptionType: plan.exceptionType,
            transferRequired: plan.transferRequired,
            fulfillmentWarehouseReference: plan.fulfillmentWarehouseReference,
            sourceWarehouseReference: plan.sourceWarehouseReference
          }))
        }
      : null,
    scheduling: snapshot.scheduling
      ? {
          eligible: snapshot.scheduling.eligible,
          status: snapshot.scheduling.status,
          schedulingReadiness: snapshot.scheduling.schedulingReadiness,
          degraded: snapshot.scheduling.degraded,
          recommendedResourceReference:
            snapshot.scheduling.recommendedResourceReference,
          proposedWindow: snapshot.scheduling.proposedWindow
            ? {
                displayWindow: snapshot.scheduling.proposedWindow.displayWindow,
                timeZone: snapshot.scheduling.proposedWindow.timeZone,
                slotSource: snapshot.scheduling.proposedWindow.slotSource,
                durationSource:
                  snapshot.scheduling.proposedWindow.durationSource,
                partsEtaConstrained:
                  snapshot.scheduling.proposedWindow.partsEtaConstrained
              }
            : null,
          candidatesApiUsed: snapshot.scheduling.candidatesApiUsed
        }
      : null
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

if (mode === "--field") {
  const path = args[1];
  if (!path) {
    console.error("Usage: parse-orchestrator-snapshot.mjs --field <dot.path>");
    process.exit(1);
  }
  const value = getPath(snapshot, path);
  if (path.endsWith(".length") && Array.isArray(getPath(snapshot, path.replace(/\.length$/, "")))) {
    console.log(formatValue(getPath(snapshot, path.replace(/\.length$/, "")).length));
    process.exit(0);
  }
  console.log(formatValue(value));
  process.exit(0);
}

console.error(`Unknown mode: ${mode}`);
process.exit(1);
