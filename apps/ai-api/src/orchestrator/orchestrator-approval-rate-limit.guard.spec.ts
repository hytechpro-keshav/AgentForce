import { HttpException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";

import type { AppConfigService } from "../config/app-config.service";
import { OrchestratorApprovalRateLimitGuard } from "./orchestrator-approval-rate-limit.guard";

function ctx(ip: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        ip,
        method: "GET",
        originalUrl: "/orchestrator/case-triage/wf-1/approve?token=x"
      })
    })
  } as unknown as ExecutionContext;
}

function buildGuard(max: number): OrchestratorApprovalRateLimitGuard {
  return new OrchestratorApprovalRateLimitGuard({
    orchestrator: {
      guardrailApproval: {
        rateLimitWindowMs: 60000,
        rateLimitMaxRequests: max
      }
    }
  } as unknown as AppConfigService);
}

describe("OrchestratorApprovalRateLimitGuard", () => {
  it("allows requests up to the ceiling then answers 429", () => {
    const guard = buildGuard(2);
    expect(guard.canActivate(ctx("1.1.1.1"))).toBe(true);
    expect(guard.canActivate(ctx("1.1.1.1"))).toBe(true);
    expect(() => guard.canActivate(ctx("1.1.1.1"))).toThrow(HttpException);
  });

  it("buckets independently per client", () => {
    const guard = buildGuard(1);
    expect(guard.canActivate(ctx("1.1.1.1"))).toBe(true);
    // A different client gets its own fresh bucket.
    expect(guard.canActivate(ctx("2.2.2.2"))).toBe(true);
  });
});
