import { Injectable, Logger } from "@nestjs/common";

import type {
  NodeLifecycleStatus,
  ApprovalDecision,
  OrchestratorNodeId
} from "./dto/case-triage-lifecycle";
import { TRIAGE_NODE_ID } from "./dto/case-triage-lifecycle";
import type { CustomerContextChannel } from "./dto/customer-context";
import type { KnowledgeGuidanceChannel } from "./dto/knowledge-guidance";
import type { OrchestratorVerdict } from "./dto/orchestrator-verdict";
import type {
  CaseTriageWorkflowSnapshot,
  OrchestrationExecutionTrace,
  OrchestrationEventDetail,
  SanitizedTriageResult
} from "./dto/orchestration-status-event";
import { OrchestrationStatusRepository } from "./orchestration-status.repository";

interface CreateWorkflowSeed {
  workflowId: string;
  caseId: string;
  caseNumber?: string;
}

interface WorkflowPatch {
  triage?: SanitizedTriageResult;
  customerContext?: CustomerContextChannel;
  knowledgeGuidance?: KnowledgeGuidanceChannel;
  orchestratorVerdict?: OrchestratorVerdict;
  approvalRequired?: boolean;
  approvalDecision?: ApprovalDecision;
  writeBackApplied?: boolean;
  failureKind?: string;
}

/**
 * In-memory read model for Node 1 workflows with durable write-through.
 *
 * The in-memory `Map` is the authoritative, low-latency cache for the
 * live instance; every mutation is written through (best-effort) to the
 * injected {@link OrchestrationStatusRepository} so historical Cases
 * still resolve by Case Id after an ai-api restart or redeploy. Reads
 * fall back to the durable store on a cache miss and warm the cache.
 *
 * This is deliberately separate from the LangGraph checkpointer (which
 * holds execution state for resume). Every event carries a monotonic
 * per-workflow sequence so the UI can order the timeline. Stored
 * snapshots are cloned on read so callers cannot mutate the store.
 */
@Injectable()
export class OrchestrationStatusStore {
  private readonly logger = new Logger(OrchestrationStatusStore.name);
  private readonly workflows = new Map<string, CaseTriageWorkflowSnapshot>();

  constructor(private readonly repository: OrchestrationStatusRepository) {}

  async createAssigned(
    seed: CreateWorkflowSeed
  ): Promise<CaseTriageWorkflowSnapshot> {
    const now = new Date().toISOString();
    const snapshot: CaseTriageWorkflowSnapshot = {
      workflowId: seed.workflowId,
      caseId: seed.caseId,
      caseNumber: seed.caseNumber,
      node: TRIAGE_NODE_ID,
      status: "assigned",
      approvalRequired: false,
      writeBackApplied: false,
      createdAt: now,
      updatedAt: now,
      events: []
    };
    // Push the first event inline rather than calling the public async
    // appendEvent — that would persist twice for the same create.
    snapshot.events.push({
      workflowId: seed.workflowId,
      caseId: seed.caseId,
      caseNumber: seed.caseNumber,
      node: TRIAGE_NODE_ID,
      status: "assigned",
      sequence: 1,
      occurredAt: now,
      safeSummary: `Triage assigned${
        seed.caseNumber ? ` for case ${seed.caseNumber}` : ""
      }.`,
      trace: {
        stepKey: "workflow_assigned",
        sections: [
          {
            key: "inputs",
            title: "Inputs",
            data: {
              caseNumberHint: seed.caseNumber ?? null,
              caseIdProvided: true
            }
          },
          {
            key: "outputs",
            title: "Outputs",
            data: {
              workflowId: seed.workflowId,
              workflowStatus: "assigned",
              currentNode: TRIAGE_NODE_ID
            }
          },
          {
            key: "state_after",
            title: "State after step",
            data: {
              status: "assigned",
              node: TRIAGE_NODE_ID,
              caseNumber: seed.caseNumber ?? null
            }
          },
          {
            key: "state_changes",
            title: "State changes",
            data: [
              { path: "status", change: "added", after: "assigned" },
              { path: "node", change: "added", after: TRIAGE_NODE_ID },
              ...(seed.caseNumber
                ? [
                    {
                      path: "caseNumber",
                      change: "added",
                      after: seed.caseNumber
                    }
                  ]
                : [])
            ]
          }
        ]
      }
    });
    this.workflows.set(seed.workflowId, snapshot);
    await this.persist(seed.workflowId);
    return this.clone(snapshot);
  }

  has(workflowId: string): boolean {
    return this.workflows.has(workflowId);
  }

  async get(
    workflowId: string
  ): Promise<CaseTriageWorkflowSnapshot | undefined> {
    const cached = this.workflows.get(workflowId);
    if (cached) {
      return this.clone(cached);
    }
    const durable = await this.repository.get(workflowId);
    if (durable) {
      this.workflows.set(workflowId, durable);
      return this.clone(durable);
    }
    return undefined;
  }

  async getLatestForCase(
    caseId: string
  ): Promise<CaseTriageWorkflowSnapshot | undefined> {
    const normalizedCaseId = caseId.trim();
    const local = this.latestLocalForCase(normalizedCaseId);
    if (local) {
      return this.clone(local);
    }
    const durable = await this.repository.getLatestForCase(normalizedCaseId);
    if (durable) {
      this.workflows.set(durable.workflowId, durable);
      return this.clone(durable);
    }
    return undefined;
  }

  list(): CaseTriageWorkflowSnapshot[] {
    return Array.from(this.workflows.values()).map((snapshot) =>
      this.clone(snapshot)
    );
  }

  async appendEvent(
    workflowId: string,
    status: NodeLifecycleStatus,
    safeSummary?: string,
    details?: OrchestrationEventDetail[],
    node: OrchestratorNodeId = TRIAGE_NODE_ID,
    trace?: OrchestrationExecutionTrace
  ): Promise<void> {
    const snapshot = this.workflows.get(workflowId);
    if (!snapshot) {
      return;
    }
    const now = new Date().toISOString();
    snapshot.events.push({
      workflowId,
      caseId: snapshot.caseId,
      caseNumber: snapshot.caseNumber,
      node,
      status,
      sequence: snapshot.events.length + 1,
      occurredAt: now,
      safeSummary,
      details: details && details.length > 0 ? details : undefined,
      trace:
        trace && trace.sections.length > 0 ? structuredClone(trace) : undefined
    });
    snapshot.status = status;
    snapshot.node = node;
    snapshot.updatedAt = now;
    await this.persist(workflowId);
  }

  async update(workflowId: string, patch: WorkflowPatch): Promise<void> {
    const snapshot = this.workflows.get(workflowId);
    if (!snapshot) {
      return;
    }
    if (patch.triage !== undefined) snapshot.triage = patch.triage;
    if (patch.customerContext !== undefined) {
      snapshot.customerContext = patch.customerContext;
    }
    if (patch.knowledgeGuidance !== undefined) {
      snapshot.knowledgeGuidance = patch.knowledgeGuidance;
    }
    if (patch.orchestratorVerdict !== undefined) {
      snapshot.orchestratorVerdict = patch.orchestratorVerdict;
    }
    if (patch.approvalRequired !== undefined) {
      snapshot.approvalRequired = patch.approvalRequired;
    }
    if (patch.approvalDecision !== undefined) {
      snapshot.approvalDecision = patch.approvalDecision;
    }
    if (patch.writeBackApplied !== undefined) {
      snapshot.writeBackApplied = patch.writeBackApplied;
    }
    if (patch.failureKind !== undefined) {
      snapshot.failureKind = patch.failureKind;
    }
    snapshot.updatedAt = new Date().toISOString();
    await this.persist(workflowId);
  }

  private latestLocalForCase(
    caseId: string
  ): CaseTriageWorkflowSnapshot | undefined {
    let latest: CaseTriageWorkflowSnapshot | undefined;
    for (const snapshot of this.workflows.values()) {
      if (snapshot.caseId !== caseId) {
        continue;
      }
      if (
        !latest ||
        OrchestrationStatusStore.isAtLeastAsRecent(snapshot, latest)
      ) {
        latest = snapshot;
      }
    }
    return latest;
  }

  /**
   * Best-effort durable write. The in-memory snapshot remains
   * authoritative for the live instance, so a durable failure is logged
   * (safe message only — no PII, no error body) and swallowed rather
   * than thrown into the workflow/run path.
   */
  private async persist(workflowId: string): Promise<void> {
    const snapshot = this.workflows.get(workflowId);
    if (!snapshot) {
      return;
    }
    try {
      await this.repository.save(this.clone(snapshot));
    } catch {
      this.logger.warn(
        `Durable persist skipped for workflow ${workflowId}; in-memory state remains authoritative.`
      );
    }
  }

  private static isAtLeastAsRecent(
    candidate: CaseTriageWorkflowSnapshot,
    current: CaseTriageWorkflowSnapshot
  ): boolean {
    if (candidate.updatedAt !== current.updatedAt) {
      return candidate.updatedAt > current.updatedAt;
    }
    return candidate.createdAt >= current.createdAt;
  }

  private clone(
    snapshot: CaseTriageWorkflowSnapshot
  ): CaseTriageWorkflowSnapshot {
    return structuredClone(snapshot);
  }
}
