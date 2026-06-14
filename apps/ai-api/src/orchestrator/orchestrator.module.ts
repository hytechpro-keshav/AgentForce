import { Module } from "@nestjs/common";

import { AgentsModule } from "../agents/agents.module";
import { AppConfigService } from "../config/app-config.service";
import { LlmModule } from "../llm/llm.module";
import { SalesforceModule } from "../salesforce/salesforce.module";
import { RagModule } from "../rag/rag.module";
import { ExternalContextAdapterRegistry } from "./adapters/external-context.adapter";
import { CaseTriageOrchestratorController } from "./case-triage-orchestrator.controller";
import { CaseTriageOrchestratorService } from "./case-triage-orchestrator.service";
import { KnowledgeGuidanceExtractor } from "./knowledge-guidance-extractor.service";
import { KnowledgeQueryBuilder } from "./knowledge-query.builder";
import { PartsLogisticsPlannerService } from "./parts-logistics-planner.service";
import {
  InMemoryOrchestrationStatusRepository,
  OrchestrationStatusRepository,
  PostgresOrchestrationStatusRepository
} from "./orchestration-status.repository";
import { OrchestrationStatusStore } from "./orchestration-status.store";

/**
 * Case-triage walking skeleton: Node 1 (triage), Node 2 (customer history),
 * and Node 3 (knowledge). Reuses the existing support-triage, customer-history
 * synthesis, and RAG answer/retrieval seams (via {@link AgentsModule} and
 * {@link RagModule}) and the outbound Salesforce gateways (via
 * {@link SalesforceModule}); it adds no second triage contract and no
 * vendor SDK usage.
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
  imports: [AgentsModule, SalesforceModule, RagModule, LlmModule],
  controllers: [CaseTriageOrchestratorController],
  providers: [
    CaseTriageOrchestratorService,
    OrchestrationStatusStore,
    ExternalContextAdapterRegistry,
    KnowledgeQueryBuilder,
    KnowledgeGuidanceExtractor,
    PartsLogisticsPlannerService,
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
