import type { TriagePriorityDto } from "../../agents/dto/triage-case.dto";
import type {
  ApprovalDecision,
  NodeLifecycleStatus,
  OrchestratorNodeId
} from "./case-triage-lifecycle";

/**
 * A single safe label/value detail attached to a status event so the
 * read-only UI can show WHAT happened at each step (e.g. reported
 * priority, provider, model). These are sanitized, non-PII facts
 * only — never raw Case text, account ids, names, prompts, or secrets.
 */
export interface OrchestrationEventDetail {
  label: string;
  value: string;
}

/**
 * Contract 4 of 4 — status event.
 *
 * Emitted by the orchestrator as Node 1 progresses. These events are
 * the only thing the read-only UI consumes. They carry sanitized
 * summaries — never raw Case text, prompts, hidden chain-of-thought,
 * approval payloads, tokens, or secrets.
 */
export interface OrchestrationStatusEvent {
  workflowId: string;
  caseId: string;
  caseNumber?: string;
  node: OrchestratorNodeId;
  status: NodeLifecycleStatus;
  /** Monotonic per-workflow sequence number for stable ordering. */
  sequence: number;
  occurredAt: string;
  /** Short, safe progress line. Optional. */
  safeSummary?: string;
  /** Safe, non-PII facts about what happened at this step. Optional. */
  details?: OrchestrationEventDetail[];
}

/**
 * Sanitized Node 1 output surfaced to the read-only UI. Mirrors the
 * existing support triage response, with provider/model metadata kept
 * for operator transparency.
 */
export interface SanitizedTriageResult {
  recommendedPriority: TriagePriorityDto;
  summary: string;
  suggestedNextStep: string;
  provider: string;
  model: string;
  fallbackUsed: boolean;
  latencyMs: number;
}

/**
 * The full read model for one Node 1 workflow. Returned by the
 * read-only status endpoint and rendered by the first-node UI.
 */
export interface CaseTriageWorkflowSnapshot {
  workflowId: string;
  caseId: string;
  caseNumber?: string;
  node: OrchestratorNodeId;
  status: NodeLifecycleStatus;
  approvalRequired: boolean;
  approvalDecision?: ApprovalDecision;
  writeBackApplied: boolean;
  triage?: SanitizedTriageResult;
  /** Safe failure classification only (no stack traces, no raw text). */
  failureKind?: string;
  createdAt: string;
  updatedAt: string;
  events: OrchestrationStatusEvent[];
}
