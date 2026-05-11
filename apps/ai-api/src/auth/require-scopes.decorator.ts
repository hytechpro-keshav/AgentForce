import { SetMetadata } from "@nestjs/common";

export const REQUIRED_SCOPES_KEY = "ai_api_required_scopes";

export const RequireScopes = (
  ...scopes: string[]
): MethodDecorator & ClassDecorator => SetMetadata(REQUIRED_SCOPES_KEY, scopes);
