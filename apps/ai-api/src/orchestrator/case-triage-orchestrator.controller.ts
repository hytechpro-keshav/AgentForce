import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  Param,
  Post,
  Req,
  ServiceUnavailableException
} from "@nestjs/common";

import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { RequireScopes } from "../auth/require-scopes.decorator";
import { CaseTriageOrchestratorService } from "./case-triage-orchestrator.service";
import type { CaseTriageWorkflowSnapshot } from "./dto/orchestration-status-event";
import { ResumeCaseTriageDto } from "./dto/resume-case-triage.dto";
import {
  TriggerCaseTriageDto,
  type TriggerCaseTriageAcceptedDto
} from "./dto/trigger-case-triage.dto";

const WORKFLOW_ID_PATTERN =
  /^wf-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CASE_ID_PATTERN = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;

/**
 * Node 1 case-triage orchestrator boundary.
 *
 * - `POST triggers` is the async, fire-and-forget handoff from the
 *   Salesforce record-triggered Flow.
 * - `GET :workflowId` is the read-only status feed the UI renders.
 * - `POST :workflowId/resume` is the OUT-OF-BAND approval channel
 *   (email / Salesforce), never the UI. It carries its own scope.
 */
@Controller("orchestrator/case-triage")
export class CaseTriageOrchestratorController {
  private readonly logger = new Logger(CaseTriageOrchestratorController.name);

  constructor(private readonly orchestrator: CaseTriageOrchestratorService) {}

  @RequireScopes("agentforce:orchestrator-triage")
  @Post("triggers")
  @HttpCode(202)
  async triggerTriage(
    @Body() body: TriggerCaseTriageDto,
    @Req() request: AuthenticatedRequest
  ): Promise<TriggerCaseTriageAcceptedDto> {
    if (!this.orchestrator.isReady()) {
      // Honest fast-fail rather than accepting work that cannot
      // possibly read or write the real Case.
      throw new ServiceUnavailableException({
        error: "orchestrator_salesforce_not_configured",
        message:
          "Outbound Salesforce connectivity is not configured on the AI API."
      });
    }
    return this.orchestrator.trigger(body, request.authPrincipal);
  }

  @RequireScopes("agentforce:orchestrator-read")
  @Get("cases/:caseId/latest")
  async getLatestForCase(
    @Param("caseId") caseId: string
  ): Promise<CaseTriageWorkflowSnapshot> {
    return this.orchestrator.getLatestSnapshotForCase(
      this.assertCaseId(caseId)
    );
  }

  @RequireScopes("agentforce:orchestrator-read")
  @Get(":workflowId")
  async getStatus(
    @Param("workflowId") workflowId: string
  ): Promise<CaseTriageWorkflowSnapshot> {
    return this.orchestrator.getSnapshot(this.assertWorkflowId(workflowId));
  }

  @RequireScopes("agentforce:orchestrator-approval")
  @Post(":workflowId/resume")
  async resume(
    @Param("workflowId") workflowId: string,
    @Body() body: ResumeCaseTriageDto
  ): Promise<CaseTriageWorkflowSnapshot> {
    return this.orchestrator.resume(this.assertWorkflowId(workflowId), body);
  }

  private assertWorkflowId(workflowId: string): string {
    if (!WORKFLOW_ID_PATTERN.test(workflowId)) {
      throw new BadRequestException({ error: "invalid_workflow_id" });
    }
    return workflowId;
  }

  private assertCaseId(caseId: string): string {
    const trimmed = caseId.trim();
    if (!CASE_ID_PATTERN.test(trimmed)) {
      throw new BadRequestException({ error: "invalid_case_id" });
    }
    return trimmed;
  }
}
