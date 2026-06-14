/**
 * Final Verdict — the orchestrator's human-readable synthesis after
 * Nodes 1-3 complete.
 *
 * This channel is **observability-only**. It is generated for the
 * read-only operator console from the already-sanitized typed channels
 * (`triage`, `customerContext`, `knowledgeGuidance`). Downstream nodes
 * MUST NOT parse it — machines consume the typed channels, humans read
 * the verdict. It carries no raw Case text, prompts, chain-of-thought,
 * account ids, or customer names: only values already present in the
 * sanitized channels (priority, risk grade, warranty, source titles).
 */

import type {
  ApprovalDecision,
  NodeLifecycleStatus
} from "./case-triage-lifecycle";
import type { CustomerContextChannel } from "./customer-context";
import type { KnowledgeGuidanceChannel } from "./knowledge-guidance";
import type { PartsLogisticsChannel } from "./parts-logistics";
import type { SanitizedTriageResult } from "./orchestration-status-event";

/** A single labeled key fact surfaced in the verdict. */
export interface OrchestratorVerdictHighlight {
  label: string;
  value: string;
}

/**
 * The synthesized, operator-facing recommendation. Rendered as a
 * ChatGPT-style panel; never consumed by downstream nodes.
 */
export interface OrchestratorVerdict {
  /** Short, scannable headline (e.g. "Critical priority — escalate"). */
  headline: string;
  /** One to two sentence operator narrative. */
  summary: string;
  /** Ordered, human-readable next steps for the operator. */
  recommendedSteps: string[];
  /** Labeled key facts pulled from the typed channels. */
  highlights: OrchestratorVerdictHighlight[];
  /**
   * Which typed channels contributed to this verdict (transparency
   * only — not a machine contract).
   */
  basis: string[];
  /** ISO timestamp of synthesis. */
  generatedAt: string;
}

/**
 * Input to the verdict synthesizer: the settled workflow facts. Only
 * the sanitized typed channels and lifecycle outcome are needed.
 */
export interface OrchestratorVerdictInput {
  status: NodeLifecycleStatus;
  writeBackApplied?: boolean;
  approvalRequired?: boolean;
  approvalDecision?: ApprovalDecision;
  triage?: SanitizedTriageResult;
  customerContext?: CustomerContextChannel;
  knowledgeGuidance?: KnowledgeGuidanceChannel;
  partsLogistics?: PartsLogisticsChannel;
}
