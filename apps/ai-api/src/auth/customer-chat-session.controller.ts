import { Body, Controller, Post, Req, UseGuards } from "@nestjs/common";

import { Public } from "./public.decorator";
import { CustomerChatSessionRateLimitGuard } from "./customer-chat-session-rate-limit.guard";
import { CustomerChatSessionService } from "./customer-chat-session.service";
import {
  CustomerChatSessionRequestDto,
  type CustomerChatSessionResponseDto
} from "./dto/customer-chat-session.dto";

interface SessionRequest {
  ip?: string;
  headers?: Record<string, unknown>;
}

@Controller("auth/customer-chat")
export class CustomerChatSessionController {
  constructor(private readonly sessions: CustomerChatSessionService) {}

  @Public()
  @UseGuards(CustomerChatSessionRateLimitGuard)
  @Post("session")
  createSession(
    @Body() body: CustomerChatSessionRequestDto,
    @Req() request: SessionRequest
  ): CustomerChatSessionResponseDto {
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
