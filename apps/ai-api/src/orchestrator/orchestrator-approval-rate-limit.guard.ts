import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable
} from "@nestjs/common";
import { createHash } from "crypto";

import { AppConfigService } from "../config/app-config.service";

interface RateBucket {
  count: number;
  resetAt: number;
}

interface RateLimitedRequest {
  ip?: string;
  headers?: Record<string, unknown>;
  method?: string;
  originalUrl?: string;
  url?: string;
}

/**
 * Sliding-window rate limit for the PUBLIC guardrail approve/reject links.
 *
 * Mirrors {@link CustomerChatSessionRateLimitGuard}: buckets by client IP hash
 * + route and answers 429 past the configured ceiling. The approve/reject
 * routes are token-gated but unauthenticated (clicked from an email), so they
 * carry their own throttle to blunt token-guessing and link-replay floods
 * (Node 6 phase plan §3.7). Window/ceiling come from the orchestrator
 * guardrail-approval config.
 */
@Injectable()
export class OrchestratorApprovalRateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, RateBucket>();

  constructor(private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RateLimitedRequest>();
    const nowMs = Date.now();
    this.pruneExpiredBuckets(nowMs);

    const { rateLimitWindowMs, rateLimitMaxRequests } =
      this.config.orchestrator.guardrailApproval;
    const key = this.bucketKey(request);
    const existing = this.buckets.get(key);

    if (!existing || existing.resetAt <= nowMs) {
      this.buckets.set(key, { count: 1, resetAt: nowMs + rateLimitWindowMs });
      return true;
    }
    if (existing.count >= rateLimitMaxRequests) {
      throw new HttpException(
        {
          error: "approval_link_rate_limited",
          message: "Too many approval link requests. Please wait and retry.",
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((existing.resetAt - nowMs) / 1000)
          )
        },
        HttpStatus.TOO_MANY_REQUESTS
      );
    }
    existing.count += 1;
    return true;
  }

  private bucketKey(request: RateLimitedRequest): string {
    return [this.clientHash(request), this.routeKey(request)].join("|");
  }

  private routeKey(request: RateLimitedRequest): string {
    const method = request.method ?? "UNKNOWN";
    const path = request.originalUrl ?? request.url ?? "unknown";
    return `${method.toUpperCase()} ${path.split("?")[0]}`;
  }

  private clientHash(request: RateLimitedRequest): string {
    const forwardedFor = request.headers?.["x-forwarded-for"];
    const clientKey =
      typeof forwardedFor === "string" && forwardedFor.trim()
        ? (forwardedFor.split(",")[0]?.trim() ?? "ip-unknown")
        : (request.ip ?? "ip-unknown");
    return createHash("sha256").update(clientKey).digest("hex").slice(0, 16);
  }

  private pruneExpiredBuckets(nowMs: number): void {
    for (const [key, bucket] of this.buckets.entries()) {
      if (bucket.resetAt <= nowMs) {
        this.buckets.delete(key);
      }
    }
  }
}
