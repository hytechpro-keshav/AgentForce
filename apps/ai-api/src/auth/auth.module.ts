import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { JwtAuthGuard } from "./jwt-auth.guard";

@Module({
  providers: [
    JwtAuthGuard,
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
