import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { CustomerChatSessionController } from "./customer-chat-session.controller";
import { CustomerChatSessionRateLimitGuard } from "./customer-chat-session-rate-limit.guard";
import { CustomerChatSessionService } from "./customer-chat-session.service";
import { JwtAuthGuard } from "./jwt-auth.guard";

@Module({
  controllers: [CustomerChatSessionController],
  providers: [
    JwtAuthGuard,
    CustomerChatSessionService,
    CustomerChatSessionRateLimitGuard,
    {
      provide: APP_GUARD,
      useExisting: JwtAuthGuard
    }
  ],
  exports: [JwtAuthGuard]
})
export class AuthModule {}

export { JwtAuthGuard };
export { Public, PUBLIC_ROUTE_KEY } from "./public.decorator";
export { RequireScopes, REQUIRED_SCOPES_KEY } from "./require-scopes.decorator";
