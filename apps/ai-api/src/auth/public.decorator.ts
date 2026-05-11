import { SetMetadata } from "@nestjs/common";

export const PUBLIC_ROUTE_KEY = "ai_api_public_route";

/**
 * Marks a route as public — the JWT guard will not enforce auth.
 * Use for health, liveness, and other unauthenticated probes.
 */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(PUBLIC_ROUTE_KEY, true);
