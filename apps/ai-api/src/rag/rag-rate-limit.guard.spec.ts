import { HttpException, HttpStatus } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";

import { RagRateLimitGuard } from "./rag-rate-limit.guard";

describe("RagRateLimitGuard", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-05-12T00:00:00Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("limits RAG requests per tenant subject route and client", () => {
    const guard = new RagRateLimitGuard(config({ rateLimitMaxRequests: 2 }));
    const context = executionContext({ originalUrl: "/rag/search" });

    expect(guard.canActivate(context)).toBe(true);
    expect(guard.canActivate(context)).toBe(true);
    expect(() => guard.canActivate(context)).toThrow(HttpException);
    expect(rateLimitStatus(guard, context)).toBe(HttpStatus.TOO_MANY_REQUESTS);
  });

  it("uses a stricter ingest limit", () => {
    const guard = new RagRateLimitGuard(
      config({ rateLimitMaxRequests: 100, ingestRateLimitMaxRequests: 1 })
    );
    const context = executionContext({ originalUrl: "/rag/ingest" });

    expect(guard.canActivate(context)).toBe(true);
    expect(() => guard.canActivate(context)).toThrow(HttpException);
  });

  it("resets the bucket after the configured window", () => {
    const guard = new RagRateLimitGuard(
      config({ rateLimitMaxRequests: 1, rateLimitWindowMs: 1000 })
    );
    const context = executionContext({
      originalUrl: "/agent/knowledge/answer"
    });

    expect(guard.canActivate(context)).toBe(true);
    expect(() => guard.canActivate(context)).toThrow(HttpException);

    jest.setSystemTime(new Date("2026-05-12T00:00:02Z"));
    expect(guard.canActivate(context)).toBe(true);
  });
});

function config(overrides: Partial<Record<string, number>> = {}): any {
  return {
    rag: {
      rateLimitWindowMs: overrides.rateLimitWindowMs ?? 60000,
      rateLimitMaxRequests: overrides.rateLimitMaxRequests ?? 60,
      ingestRateLimitMaxRequests: overrides.ingestRateLimitMaxRequests ?? 10
    }
  };
}

function rateLimitStatus(
  guard: RagRateLimitGuard,
  context: ExecutionContext
): number | undefined {
  try {
    guard.canActivate(context);
  } catch (err) {
    return err instanceof HttpException ? err.getStatus() : undefined;
  }
  return undefined;
}

function executionContext(
  requestOverrides: Partial<Record<string, unknown>> = {}
): ExecutionContext {
  const request = {
    method: "POST",
    originalUrl: "/rag/search",
    ip: "203.0.113.10",
    headers: {},
    authPrincipal: {
      subject: "agentforce-runtime",
      tenantId: "tenant-demo",
      scopes: ["rag:search"],
      raw: {}
    },
    ...requestOverrides
  };
  return {
    switchToHttp: () => ({ getRequest: () => request })
  } as unknown as ExecutionContext;
}
