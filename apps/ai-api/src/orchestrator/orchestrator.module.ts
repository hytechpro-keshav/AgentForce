import { Module } from "@nestjs/common";

import { AgentsModule } from "../agents/agents.module";
import { AppConfigService } from "../config/app-config.service";
import { SalesforceModule } from "../salesforce/salesforce.module";
import { CaseTriageOrchestratorController } from "./case-triage-orchestrator.controller";
import { CaseTriageOrchestratorService } from "./case-triage-orchestrator.service";
import {
  InMemoryOrchestrationStatusRepository,
  OrchestrationStatusRepository,
  PostgresOrchestrationStatusRepository
} from "./orchestration-status.repository";
import { OrchestrationStatusStore } from "./orchestration-status.store";

/**
 * Node 1 case-triage walking skeleton. Reuses the existing support
 * triage seam (via {@link AgentsModule}) and the outbound Salesforce
 * gateway (via {@link SalesforceModule}); it adds no second triage
 * contract and no vendor SDK usage.
 *
 * The durable read model is bound by config. The Postgres repository
 * is registered as its own provider so Nest runs its
 * `OnModuleInit`/`OnModuleDestroy` (pool open + migrate, pool close);
 * the abstract token then resolves to either the Postgres or the
 * in-memory implementation depending on
 * `AI_API_ORCHESTRATOR_PERSISTENCE_PROVIDER`. `AppConfigService` is
 * provided by the global `AppConfigModule`.
 */
@Module({
  imports: [AgentsModule, SalesforceModule],
  controllers: [CaseTriageOrchestratorController],
  providers: [
    CaseTriageOrchestratorService,
    OrchestrationStatusStore,
    PostgresOrchestrationStatusRepository,
    {
      provide: OrchestrationStatusRepository,
      useFactory: (
        config: AppConfigService,
        postgres: PostgresOrchestrationStatusRepository
      ): OrchestrationStatusRepository =>
        config.orchestrator.persistence.provider === "postgres"
          ? postgres
          : new InMemoryOrchestrationStatusRepository(),
      inject: [AppConfigService, PostgresOrchestrationStatusRepository]
    }
  ]
})
export class OrchestratorModule {}
