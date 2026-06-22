import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy
} from "@nestjs/common";

import { AppConfigService } from "../config/app-config.service";
import { SalesforceCaseGateway } from "../salesforce/salesforce-case.gateway";
import { GUARDRAIL_NODE_ID } from "./dto/case-triage-lifecycle";
import type { NodeLifecycleStatus } from "./dto/case-triage-lifecycle";
import type { GuardrailApprovalInterrupt } from "./dto/guardrail";
import type {
  CaseTriageWorkflowSnapshot,
  OrchestrationExecutionTrace
} from "./dto/orchestration-status-event";
import type { OrchestratorVerdict } from "./dto/orchestrator-verdict";
import { synthesizeOrchestratorVerdict } from "./orchestrator-verdict.synthesizer";
import { GuardrailApprovalNotificationService } from "./guardrail-approval-notification.service";
import { OrchestrationStatusStore } from "./orchestration-status.store";

/**
 * Node 6 6c (N6-R1) — approval timeout sweep.
 *
 * A periodic sweep of the snapshot store that auto-settles a stale
 * `waiting_approval` workflow once it exceeds the configured SLA. Disabled by
 * default (6b+ parity); the interval starts only when the timeout is enabled.
 *
 * **Mechanism (the subtle part):** the sweep does NOT call `graph.resume()`.
 * `escalated`/`rejected` are not resumable decisions (R6), and with the
 * `MemorySaver` checkpointer the paused thread may already be orphaned after a
 * restart. The snapshot store (which persists independently of the checkpoint)
 * is the source of truth, so the sweep performs the SAME direct terminal
 * settle the deterministic `escalate` branch does — snapshot + Case — and
 * mints NO Salesforce callback token. Idempotent via {@link timedOut} plus the
 * terminal-status guard, so overlapping sweeps never double-settle.
 *
 * Implemented with a self-managed, unref'd interval rather than `@Cron` to
 * avoid a new runtime dependency; {@link sweep} is the directly testable core.
 */
@Injectable()
export class GuardrailApprovalTimeoutService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(GuardrailApprovalTimeoutService.name);
  private readonly timedOut = new Set<string>();
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly store: OrchestrationStatusStore,
    private readonly config: AppConfigService,
    private readonly gateway: SalesforceCaseGateway,
    private readonly notifications: GuardrailApprovalNotificationService
  ) {}

  onApplicationBootstrap(): void {
    const cfg = this.config.orchestrator.guardrailApproval.timeout;
    if (!cfg.enabled) {
      return;
    }
    this.timer = setInterval(() => {
      void this.sweep().catch((err) => {
        this.logger.warn(
          `Guardrail approval timeout sweep errored: ${
            (err as Error).name ?? "unknown"
          }`
        );
      });
    }, cfg.scanSeconds * 1000);
    // Never hold the process open for the sweep (mirrors a cron sidecar).
    this.timer.unref?.();
    this.logger.log(
      `Guardrail approval timeout sweep started: every ${cfg.scanSeconds}s, ` +
        `SLA ${cfg.timeoutSeconds}s, action ${cfg.action}.`
    );
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * One sweep pass: settle every stale `waiting_approval` workflow directly on
   * the snapshot store. Idempotent via {@link timedOut}. `now` is injectable so
   * tests are deterministic. Returns the number of workflows settled.
   */
  async sweep(now: number = Date.now()): Promise<number> {
    const cfg = this.config.orchestrator.guardrailApproval.timeout;
    if (!cfg.enabled) {
      return 0;
    }
    const cutoff = now - cfg.timeoutSeconds * 1000;
    let settled = 0;
    for (const snapshot of this.store.list()) {
      if (snapshot.status !== "waiting_approval") {
        continue;
      }
      if (this.timedOut.has(snapshot.workflowId)) {
        continue;
      }
      const waitingSince =
        GuardrailApprovalTimeoutService.waitingSinceMs(snapshot);
      if (waitingSince === undefined || waitingSince > cutoff) {
        continue; // not waiting long enough yet
      }
      // Mark BEFORE the await so a concurrent sweep cannot re-enter.
      this.timedOut.add(snapshot.workflowId);
      await this.settleTimedOut(snapshot, cfg.action);
      settled++;
    }
    return settled;
  }

  private async settleTimedOut(
    snapshot: CaseTriageWorkflowSnapshot,
    action: "escalate" | "reject"
  ): Promise<void> {
    const terminalStatus: NodeLifecycleStatus =
      action === "reject" ? "rejected" : "escalated";
    // Mirror the Case guardrail status (degrade-safe). NO SF callback token is
    // minted — escalated/rejected are not resumable, so there is nothing to
    // call back into.
    await this.writeGuardrailStatus(snapshot.caseId, terminalStatus);
    await this.store.update(snapshot.workflowId, {
      approvalRequired: false,
      approvalDecision: terminalStatus,
      orchestratorVerdict: GuardrailApprovalTimeoutService.buildVerdict(
        snapshot,
        terminalStatus
      )
    });
    await this.store.appendEvent(
      snapshot.workflowId,
      terminalStatus,
      `Approval timed out — auto-${action}d after the SLA.`,
      undefined,
      GUARDRAIL_NODE_ID,
      GuardrailApprovalTimeoutService.buildTrace(snapshot, action)
    );
    if (terminalStatus === "escalated") {
      // Degrade-safe supervisor notice (email is OFF this rollout → no-op).
      await this.notifications.notifyEscalation(
        snapshot.workflowId,
        snapshot.caseId,
        GuardrailApprovalTimeoutService.buildInterruptPayload(snapshot)
      );
    }
    this.logger.log(
      `Guardrail approval timed out: workflow=${snapshot.workflowId} → ${terminalStatus}.`
    );
  }

  private async writeGuardrailStatus(
    caseId: string,
    status: string
  ): Promise<void> {
    try {
      await this.gateway.writeGuardrailStatus(caseId, status);
    } catch {
      this.logger.warn(
        `Guardrail status write skipped for case ${caseId}; snapshot terminal state remains authoritative.`
      );
    }
  }

  /** Milliseconds since the pause began (the latest waiting_approval event). */
  private static waitingSinceMs(
    snapshot: CaseTriageWorkflowSnapshot
  ): number | undefined {
    let iso: string | undefined;
    for (const event of snapshot.events) {
      if (event.status === "waiting_approval") {
        iso = event.occurredAt;
      }
    }
    const ms = Date.parse(iso ?? snapshot.updatedAt);
    return Number.isNaN(ms) ? undefined : ms;
  }

  private static buildVerdict(
    snapshot: CaseTriageWorkflowSnapshot,
    status: NodeLifecycleStatus
  ): OrchestratorVerdict {
    return synthesizeOrchestratorVerdict({
      status,
      writeBackApplied: false,
      approvalRequired: false,
      approvalDecision: status === "rejected" ? "rejected" : "escalated",
      triage: snapshot.triage,
      customerContext: snapshot.customerContext,
      knowledgeGuidance: snapshot.knowledgeGuidance,
      partsLogistics: snapshot.partsLogistics,
      scheduling: snapshot.scheduling,
      guardrail: snapshot.guardrail
    });
  }

  /** Minimal, non-PII interrupt payload for the escalation notice. */
  private static buildInterruptPayload(
    snapshot: CaseTriageWorkflowSnapshot
  ): GuardrailApprovalInterrupt {
    const guardrail = snapshot.guardrail;
    return {
      action: "approve_case_workflow",
      workflowId: snapshot.workflowId,
      caseId: snapshot.caseId,
      caseNumber: snapshot.caseNumber,
      guardrail: {
        riskScore: guardrail?.riskScore ?? 0,
        riskLevel: guardrail?.riskLevel ?? "low",
        policyRulesTriggered:
          guardrail?.policyRulesTriggered.map((rule) => rule.ruleId) ?? [],
        approvalReasons: guardrail?.approvalReasons ?? []
      },
      context: {
        recommendedPriority: snapshot.triage?.recommendedPriority ?? "unknown"
      }
    };
  }

  private static buildTrace(
    snapshot: CaseTriageWorkflowSnapshot,
    action: "escalate" | "reject"
  ): OrchestrationExecutionTrace {
    const terminalStatus = action === "reject" ? "rejected" : "escalated";
    return {
      stepKey: `approval_timeout_${action}`,
      sections: [
        {
          key: "inputs",
          title: "Inputs",
          data: {
            previousStatus: "waiting_approval",
            timeoutAction: action,
            resumeCalled: false,
            salesforceTokenMinted: false
          }
        },
        {
          key: "outputs",
          title: "Outputs",
          data: {
            workflowStatus: terminalStatus,
            writeBackApplied: false
          }
        },
        {
          key: "state_changes",
          title: "State changes",
          data: [
            {
              path: "status",
              change: "modified",
              before: "waiting_approval",
              after: terminalStatus
            }
          ]
        }
      ]
    };
  }
}
