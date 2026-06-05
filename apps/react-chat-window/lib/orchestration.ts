/**
 * Read-only orchestration view model for the Node 1 case-triage
 * walking skeleton.
 *
 * Everything here is customer/operator-SAFE. The browser only ever
 * sees sanitized status events and the sanitized triage output. No
 * bearer tokens, no raw Case text, and no hidden chain-of-thought
 * reach this layer — and {@link sanitizeSnapshot} drops anything
 * unexpected as defense in depth.
 */

export const ORCHESTRATION_STATUSES = [
  "assigned",
  "running",
  "done",
  "waiting_approval",
  "rejected",
  "failed"
] as const;

export type OrchestrationStatus = (typeof ORCHESTRATION_STATUSES)[number];

export const TRIAGE_PRIORITIES = ["low", "normal", "high", "critical"] as const;
export type TriagePriority = (typeof TRIAGE_PRIORITIES)[number];

export interface OrchestrationEventDetail {
  label: string;
  value: string;
}

export interface OrchestrationEvent {
  status: OrchestrationStatus;
  sequence: number;
  occurredAt: string;
  safeSummary?: string;
  details?: OrchestrationEventDetail[];
}

export interface OrchestrationTriage {
  recommendedPriority: TriagePriority;
  summary: string;
  suggestedNextStep: string;
  provider: string;
  model: string;
  fallbackUsed: boolean;
  latencyMs: number;
}

export interface OrchestrationSnapshot {
  workflowId: string;
  caseNumber?: string;
  status: OrchestrationStatus;
  approvalRequired: boolean;
  writeBackApplied: boolean;
  failureKind?: string;
  triage?: OrchestrationTriage;
  events: OrchestrationEvent[];
  updatedAt?: string;
}

export const WORKFLOW_ID_PATTERN =
  /^wf-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const CASE_ID_PATTERN = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;

export function isValidWorkflowId(value: string): boolean {
  return WORKFLOW_ID_PATTERN.test(value);
}

export function isValidCaseId(value: string): boolean {
  return CASE_ID_PATTERN.test(value);
}

export function isTerminalStatus(status: OrchestrationStatus): boolean {
  return status === "done" || status === "rejected" || status === "failed";
}

interface StatusMeta {
  label: string;
  /** Tailwind badge classes for this lifecycle state. */
  tone: string;
}

export const STATUS_META: Record<OrchestrationStatus, StatusMeta> = {
  assigned: { label: "Assigned", tone: "bg-slate-100 text-slate-700" },
  running: { label: "Running", tone: "bg-blue-100 text-blue-700" },
  waiting_approval: {
    label: "Waiting for approval",
    tone: "bg-amber-100 text-amber-800"
  },
  done: { label: "Done", tone: "bg-green-100 text-green-700" },
  rejected: { label: "Rejected", tone: "bg-red-100 text-red-700" },
  failed: { label: "Failed", tone: "bg-red-100 text-red-700" }
};

export function statusLabel(status: OrchestrationStatus): string {
  return STATUS_META[status]?.label ?? status;
}

function isStatus(value: unknown): value is OrchestrationStatus {
  return (
    typeof value === "string" &&
    (ORCHESTRATION_STATUSES as readonly string[]).includes(value)
  );
}

function isPriority(value: unknown): value is TriagePriority {
  return (
    typeof value === "string" &&
    (TRIAGE_PRIORITIES as readonly string[]).includes(value)
  );
}

function str(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : undefined;
}

function sanitizeTriage(value: unknown): OrchestrationTriage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (!isPriority(record.recommendedPriority)) return undefined;
  return {
    recommendedPriority: record.recommendedPriority,
    summary: str(record.summary, 280) ?? "",
    suggestedNextStep: str(record.suggestedNextStep, 280) ?? "",
    provider: str(record.provider, 60) ?? "",
    model: str(record.model, 120) ?? "",
    fallbackUsed: record.fallbackUsed === true,
    latencyMs:
      typeof record.latencyMs === "number" && record.latencyMs >= 0
        ? Math.round(record.latencyMs)
        : 0
  };
}

function sanitizeEvents(value: unknown): OrchestrationEvent[] {
  if (!Array.isArray(value)) return [];
  const out: OrchestrationEvent[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    if (!isStatus(record.status)) continue;
    out.push({
      status: record.status,
      sequence:
        typeof record.sequence === "number" ? record.sequence : out.length + 1,
      occurredAt: str(record.occurredAt, 40) ?? "",
      safeSummary: str(record.safeSummary, 240),
      details: sanitizeDetails(record.details)
    });
  }
  return out.sort((a, b) => a.sequence - b.sequence);
}

/**
 * Coerce untrusted event details into a safe, bounded label/value list.
 * Caps the number of details and clips each field, dropping anything
 * that is not a non-empty string pair.
 */
function sanitizeDetails(
  value: unknown
): OrchestrationEventDetail[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: OrchestrationEventDetail[] = [];
  for (const raw of value) {
    if (out.length >= 8) break;
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const label = str(record.label, 40);
    const detailValue = str(record.value, 120);
    if (!label || !detailValue) continue;
    out.push({ label, value: detailValue });
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Defensively coerce an untrusted proxy response into a safe
 * snapshot. Returns null when the payload is not a recognizable
 * workflow snapshot.
 */
export function sanitizeSnapshot(value: unknown): OrchestrationSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const workflowId = str(record.workflowId, 64);
  if (!workflowId || !isStatus(record.status)) return null;
  return {
    workflowId,
    caseNumber: str(record.caseNumber, 32),
    status: record.status,
    approvalRequired: record.approvalRequired === true,
    writeBackApplied: record.writeBackApplied === true,
    failureKind: str(record.failureKind, 60),
    triage: sanitizeTriage(record.triage),
    events: sanitizeEvents(record.events),
    updatedAt: str(record.updatedAt, 40)
  };
}
