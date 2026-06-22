import { Body, Controller, Post, Req, UseGuards } from "@nestjs/common";

import { Public } from "./public.decorator";
import { OperatorOrchestrationSessionRateLimitGuard } from "./operator-orchestration-session-rate-limit.guard";
import { OperatorOrchestrationSessionService } from "./operator-orchestration-session.service";
import {
  OperatorOrchestrationSessionRequestDto,
  type OperatorOrchestrationSessionResponseDto
} from "./dto/operator-orchestration-session.dto";

interface SessionRequest {
  ip?: string;
  headers?: Record<string, unknown>;
}

/**
 * RC-8a (Node 6 6c) — operator console login. The Next.js console BFF posts the
 * shared access code here and stores the returned short-TTL token as an
 * httpOnly cookie, then attaches it server-side on the Stop-AI proxy. `@Public`
 * (it IS the login); rate-limited against brute force.
 */
@Controller("auth/operator-orchestration")
export class OperatorOrchestrationSessionController {
  constructor(private readonly sessions: OperatorOrchestrationSessionService) {}

  @Public()
  @UseGuards(OperatorOrchestrationSessionRateLimitGuard)
  @Post("session")
  createSession(
    @Body() body: OperatorOrchestrationSessionRequestDto,
    @Req() request: SessionRequest
  ): OperatorOrchestrationSessionResponseDto {
    return this.sessions.createSession(body, this.clientKey(request));
  }

  private clientKey(request: SessionRequest): string {
    const forwardedFor = request.headers?.["x-forwarded-for"];
    if (typeof forwardedFor === "string" && forwardedFor.trim()) {
      return forwardedFor.split(",")[0]?.trim() ?? "ip-unknown";
    }
    return request.ip ?? "ip-unknown";
  }
}
