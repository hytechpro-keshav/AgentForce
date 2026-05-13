import { Module } from "@nestjs/common";

import { LlmModule } from "../llm/llm.module";
import { VectorDbModule } from "../vector-db/vector-db.module";
import { KnowledgeAgentController } from "./knowledge-agent.controller";
import { RagAnswerCacheService } from "./rag-answer-cache.service";
import { RagAnswerService } from "./rag-answer.service";
import { RagRateLimitGuard } from "./rag-rate-limit.guard";
import { RagController } from "./rag.controller";
import { RagIngestionService } from "./rag-ingestion.service";
import { RagRetrievalService } from "./rag-retrieval.service";

@Module({
  imports: [LlmModule, VectorDbModule],
  controllers: [RagController, KnowledgeAgentController],
  providers: [
    RagIngestionService,
    RagRetrievalService,
    RagAnswerCacheService,
    RagAnswerService,
    RagRateLimitGuard
  ],
  exports: [
    RagIngestionService,
    RagRetrievalService,
    RagAnswerCacheService,
    RagAnswerService
  ]
})
export class RagModule {}
