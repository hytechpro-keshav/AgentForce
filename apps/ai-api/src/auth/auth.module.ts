import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { CustomerChatSessionController } from "./customer-chat-session.controller";
import { CustomerChatSessionRateLimitGuard } from "./customer-chat-session-rate-limit.guard";
import { CustomerChatSessionService } from "./customer-chat-session.service";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { OAuthTokenController } from "./oauth-token.controller";
import { OAuthTokenService } from "./oauth-token.service";
import { OperatorOrchestrationSessionController } from "./operator-orchestration-session.controller";
import { OperatorOrchestrationSessionRateLimitGuard } from "./operator-orchestration-session-rate-limit.guard";
import { OperatorOrchestrationSessionService } from "./operator-orchestration-session.service";
import { TenantOperationsController } from "./tenant-operations.controller";
import { TenantOperationsService } from "./tenant-operations.service";
import { TenantRegistryService } from "./tenant-registry.service";

@Module({
  controllers: [
    CustomerChatSessionController,
    OAuthTokenController,
    OperatorOrchestrationSessionController,
    TenantOperationsController
  ],
  providers: [
    JwtAuthGuard,
    CustomerChatSessionService,
    CustomerChatSessionRateLimitGuard,
    OperatorOrchestrationSessionService,
    OperatorOrchestrationSessionRateLimitGuard,
    OAuthTokenService,
    TenantOperationsService,
    TenantRegistryService,
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
