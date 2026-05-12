import { ForbiddenException } from "@nestjs/common";

import type { AuthPrincipal } from "../auth/jwt-auth.guard";
import { AppConfigService } from "../config/app-config.service";
import type {
  RagAccessMetadata,
  RagChunkMetadata
} from "../vector-db/vector-db.types";

export interface TrustedRagContext {
  tenantId: string;
  namespace: string;
  subject: string;
  scopes: string[];
  roles: string[];
}

export function resolveTrustedRagContext(
  principal: AuthPrincipal | undefined,
  requestedNamespace: string | undefined,
  config: AppConfigService
): TrustedRagContext {
  if (!principal?.tenantId) {
    throw new ForbiddenException(
      "RAG requests require a trusted tenant claim."
    );
  }
  const namespace =
    readStringClaim(principal.raw["rag_namespace"]) ??
    readStringClaim(principal.raw["namespace"]) ??
    config.rag.defaultNamespace;
  if (requestedNamespace && requestedNamespace !== namespace) {
    throw new ForbiddenException(
      "Requested RAG namespace is not trusted for this principal."
    );
  }

  return {
    tenantId: principal.tenantId,
    namespace,
    subject: principal.subject,
    scopes: principal.scopes,
    roles: readStringArrayClaim(principal.raw["roles"] ?? principal.raw["role"])
  };
}

export function normalizeAccessMetadata(
  access: Partial<RagAccessMetadata> | undefined
): RagAccessMetadata {
  return {
    visibility: access?.visibility ?? "tenant",
    allowedSubjects: access?.allowedSubjects ?? [],
    allowedScopes: access?.allowedScopes ?? [],
    allowedRoles: access?.allowedRoles ?? []
  };
}

export function isAuthorizedForChunk(
  metadata: RagChunkMetadata,
  context: TrustedRagContext
): boolean {
  if (
    metadata.deleted ||
    metadata.tenantId !== context.tenantId ||
    metadata.namespace !== context.namespace
  ) {
    return false;
  }
  const access = metadata.access;
  if (access.visibility === "public" || access.visibility === "tenant") {
    return true;
  }
  return (
    access.allowedSubjects.includes(context.subject) ||
    access.allowedScopes.some((scope) => context.scopes.includes(scope)) ||
    access.allowedRoles.some((role) => context.roles.includes(role))
  );
}

function readStringClaim(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readStringArrayClaim(value: unknown): string[] {
  if (typeof value === "string") {
    return value.split(" ").filter(Boolean);
  }
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
