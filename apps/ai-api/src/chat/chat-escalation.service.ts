import { Injectable, Logger } from "@nestjs/common";
import { createHash, randomUUID } from "crypto";

import type {
  ChatEscalationRequestDto,
  ChatEscalationResponseDto
} from "./dto/chat-escalation.dto";

/**
 * Phase 6 customer-chat escalation acknowledgement service.
 *
 * Receives a customer-safe escalation request from the React chat
 * window and returns a structured acknowledgement. It does not
 * write to Salesforce directly. Downstream Agentforce/Apex
 * integration is intentionally deferred so this endpoint cannot
 * leak Salesforce credentials or perform unsafe writes.
 *
 * Logging policy: only structural fields (urgency, locale length,
 * whether a caseReference was provided) are emitted. No reason
 * text, no conversation summary, no PII.
 */
@Injectable()
export class ChatEscalationService {
  private readonly logger = new Logger(ChatEscalationService.name);

  acknowledge(
    request: ChatEscalationRequestDto,
    subject: string | undefined
  ): ChatEscalationResponseDto {
    const escalationId = `esc-${randomUUID()}`;
    const urgency = request.urgency ?? "normal";
    const receivedAt = new Date().toISOString();

    this.logger.log(
      `chat.escalate received escalationId=${escalationId} urgency=${urgency} hasCaseRef=${
        request.caseReference ? "1" : "0"
      } hasSummary=${request.conversationSummary ? "1" : "0"} subjectHash=${ChatEscalationService.safeSubjectHash(
        subject
      )}`
    );

    return {
      escalationId,
      status: "received",
      urgency,
      receivedAt,
      nextSteps:
        "Your request has been received. A support specialist will follow up using the contact information on your account.",
      requestId: request.requestId
    };
  }

  private static safeSubjectHash(subject: string | undefined): string {
    return createHash("sha256")
      .update(subject ?? "anonymous")
      .digest("hex")
      .slice(0, 16);
  }
}
