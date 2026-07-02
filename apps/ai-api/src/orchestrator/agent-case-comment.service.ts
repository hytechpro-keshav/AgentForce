import { Injectable, Logger } from "@nestjs/common";

import { SalesforceCaseGateway } from "../salesforce/salesforce-case.gateway";
import {
  buildAgentCaseNarrative,
  type AgentNarrativeKey,
  AGENT_NARRATIVE_KEYS
} from "./agent-case-narrative.builder";
import type { CaseTriageStateType } from "./case-triage.graph";

/**
 * Idempotent, degrade-safe poster for the five visible agent Case comments.
 *
 * Stepped console: keys on `caseId:agentKey` so only one comment per agent per
 * Case; Triage may repost when the LLM summary changes after Run.
 *
 * Auto graph (SF approval path): keys on `workflowId:agentKey` and posts all
 * five narratives in one batch at guardrail submit time.
 */
@Injectable()
export class AgentCaseCommentService {
  private readonly logger = new Logger(AgentCaseCommentService.name);
  /** marker -> posted body (for stepped triage refresh detection). */
  private readonly postedBodies = new Map<string, string>();

  constructor(private readonly gateway: SalesforceCaseGateway) {}

  /**
   * Posts one private agent narrative when Salesforce is configured.
   * Stepped mode uses case-level idempotency; auto mode uses workflow id.
   */
  async postAgentNarrative(
    workflowId: string,
    caseId: string,
    agentKey: AgentNarrativeKey,
    state: CaseTriageStateType,
    options?: { stepped?: boolean }
  ): Promise<void> {
    const stepped = options?.stepped === true;
    const marker = stepped
      ? `${caseId}:${agentKey}`
      : `${workflowId}:${agentKey}`;
    if (!this.gateway.isConfigured()) {
      return;
    }
    const body = buildAgentCaseNarrative(agentKey, state);
    if (!body) {
      return;
    }
    const previous = this.postedBodies.get(marker);
    if (previous === body) {
      return;
    }
    // Stepped Triage may refresh after the LLM runs; other agents post once.
    if (previous && !(stepped && agentKey === "triage")) {
      return;
    }
    try {
      const result = await this.gateway.postCaseComment({
        caseId,
        commentBody: body
      });
      if (result.posted) {
        this.postedBodies.set(marker, body);
        this.logger.log(
          `Agent Case comment posted: case=${caseId} agent=${agentKey} stepped=${stepped}`
        );
      } else {
        this.logger.warn(
          `Agent Case comment degraded: case=${caseId} agent=${agentKey}`
        );
      }
    } catch (err) {
      this.logger.warn(
        `Agent Case comment degraded: workflow=${workflowId} agent=${agentKey} ` +
          `reason=${(err as Error).name ?? "unknown"}`
      );
    }
  }

  /**
   * Auto-graph path: post all five agent narratives once before SF approval
   * submit. Idempotent per workflow.
   */
  async postAllForAutoApproval(
    workflowId: string,
    caseId: string,
    state: CaseTriageStateType
  ): Promise<void> {
    for (const agentKey of AGENT_NARRATIVE_KEYS) {
      await this.postAgentNarrative(workflowId, caseId, agentKey, state, {
        stepped: false
      });
    }
  }
}
