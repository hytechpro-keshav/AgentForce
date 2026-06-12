import type { TriagePriorityDto } from "../../agents/dto/triage-case.dto";
import type {
  ApprovalDecision,
  NodeLifecycleStatus,
  OrchestratorNodeId
} from "./case-triage-lifecycle";
import type { CustomerContextChannel } from "./customer-context";
import type { KnowledgeGuidanceChannel } from "./knowledge-guidance";
import type { OrchestratorVerdict } from "./orchestrator-verdict";

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

export type OrchestrationTraceValue =
  | string
  | number
  | boolean
  | null
  | OrchestrationTraceValue[]
  | { [key: string]: OrchestrationTraceValue }
  | object;

export interface OrchestrationStateChange {
  path: string;
  change: "added" | "modified";
  before?: OrchestrationTraceValue;
  after?: OrchestrationTraceValue;
}

export interface OrchestrationTraceSection {
  key: string;
  title: string;
  data: OrchestrationTraceValue;
}

/**
 * Auditable execution artifact for one safe orchestration step.
 * Includes only engineering-visible evidence such as data sources,
 * inputs, outputs, and state changes; never hidden model reasoning.
 */
export interface OrchestrationExecutionTrace {
  stepKey: string;
  sections: OrchestrationTraceSection[];
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
  /** Structured, auditable execution trace for engineering review. */
  trace?: OrchestrationExecutionTrace;
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
 * The full read model for one Node 1-3 workflow. Returned by the
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
  /**
   * Node 2 (customer history) output. Self-contained and sanitized so
   * the read-only UI can render the Customer Context Package. Absent
   * until Node 2 runs; present-but-skipped when the case is ineligible.
   */
  customerContext?: CustomerContextChannel;
  /**
   * Node 3 (knowledge) output. Self-contained and sanitized so the
   * read-only UI can render knowledge guidance and source citations.
   * Absent until Node 3 runs; present-but-skipped when ineligible or
   * RAG disabled.
   */
  knowledgeGuidance?: KnowledgeGuidanceChannel;
  /**
   * Final Verdict — observability-only synthesis after Nodes 1-3.
   * Generated for the operator console from the typed channels; never
   * parsed by downstream nodes. Absent until the workflow settles.
   */
  orchestratorVerdict?: OrchestratorVerdict;
  /** Safe failure classification only (no stack traces, no raw text). */
  failureKind?: string;
  createdAt: string;
  updatedAt: string;
  events: OrchestrationStatusEvent[];
}
