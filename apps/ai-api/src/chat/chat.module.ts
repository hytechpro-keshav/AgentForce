import { Module } from "@nestjs/common";

import { LlmModule } from "../llm/llm.module";
import { RagModule } from "../rag/rag.module";
import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";
import { ChatEscalationService } from "./chat-escalation.service";

@Module({
  imports: [LlmModule, RagModule],
  controllers: [ChatController],
  providers: [ChatService, ChatEscalationService],
  exports: [ChatService]
})
export class ChatModule {}
