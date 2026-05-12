import { HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";

import { OpenAiCompatibleRateLimitGuard } from "./openai-compatible-rate-limit.guard";

describe("OpenAiCompatibleRateLimitGuard", () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.useFakeTimers().setSystemTime(new Date("2026-05-12T00:00:00Z"));
  });

  afterEach(() => {
    warnSpy.mockRestore();
    jest.useRealTimers();
  });

  it("limits gateway requests per tenant subject and route", () => {
    const guard = new OpenAiCompatibleRateLimitGuard(
      config({ rateLimitMaxRequests: 2 })
    );
    const context = executionContext({ originalUrl: "/v1/chat/completions" });

    expect(guard.canActivate(context)).toBe(true);
    expect(guard.canActivate(context)).toBe(true);
    expect(() => guard.canActivate(context)).toThrow(HttpException);
    expect(rateLimitStatus(guard, context)).toBe(HttpStatus.TOO_MANY_REQUESTS);
  });

  it("does not let spoofed forwarded-for headers create a fresh bucket", () => {
    const guard = new OpenAiCompatibleRateLimitGuard(
      config({ rateLimitMaxRequests: 1 })
    );
    const first = executionContext({
      headers: { "x-forwarded-for": "203.0.113.10" }
    });
    const spoofed = executionContext({
      headers: { "x-forwarded-for": "198.51.100.11" }
    });

    expect(guard.canActivate(first)).toBe(true);
    expect(() => guard.canActivate(spoofed)).toThrow(HttpException);
  });

  it("resets the bucket after the configured window", () => {
    const guard = new OpenAiCompatibleRateLimitGuard(
      config({ rateLimitMaxRequests: 1, rateLimitWindowMs: 1000 })
    );
    const context = executionContext();

    expect(guard.canActivate(context)).toBe(true);
    expect(() => guard.canActivate(context)).toThrow(HttpException);

    jest.setSystemTime(new Date("2026-05-12T00:00:02Z"));
    expect(guard.canActivate(context)).toBe(true);
  });
});

function config(overrides: Partial<Record<string, number>> = {}): any {
  return {
    openAiGateway: {
      rateLimitWindowMs: overrides.rateLimitWindowMs ?? 60000,
      rateLimitMaxRequests: overrides.rateLimitMaxRequests ?? 120,
      ragModelId: "knowledge-rag"
    }
  };
}

function rateLimitStatus(
  guard: OpenAiCompatibleRateLimitGuard,
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
    originalUrl: "/v1/chat/completions",
    ip: "203.0.113.10",
    headers: {},
    authPrincipal: {
      subject: "openwebui-internal-console",
      tenantId: "tenant-demo",
      scopes: ["openwebui:chat"],
      raw: {}
    },
    ...requestOverrides
  };
  return {
    switchToHttp: () => ({ getRequest: () => request })
  } as unknown as ExecutionContext;
}
