import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger
} from "@nestjs/common";
import { createHash } from "crypto";

import type { AuthPrincipal } from "../auth/jwt-auth.guard";
import { AppConfigService } from "../config/app-config.service";

interface RateBucket {
  count: number;
  resetAt: number;
}

interface RateLimitedRequest {
  authPrincipal?: AuthPrincipal;
  ip?: string;
  headers?: Record<string, unknown>;
  method?: string;
  originalUrl?: string;
  url?: string;
}

@Injectable()
export class OpenAiCompatibleRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(OpenAiCompatibleRateLimitGuard.name);
  private readonly buckets = new Map<string, RateBucket>();

  constructor(private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RateLimitedRequest>();
    const nowMs = Date.now();
    this.pruneExpiredBuckets(nowMs);

    const { rateLimitWindowMs, rateLimitMaxRequests } =
      this.config.openAiGateway;
    const key = this.bucketKey(request);
    const existing = this.buckets.get(key);

    if (!existing || existing.resetAt <= nowMs) {
      this.buckets.set(key, {
        count: 1,
        resetAt: nowMs + rateLimitWindowMs
      });
      return true;
    }

    if (existing.count >= rateLimitMaxRequests) {
      this.logger.warn(
        `OpenAI-compatible gateway rate limited tenant=${this.safeTenant(request)} subjectHash=${this.subjectHash(request)} route=${this.routeKey(request)}`
      );
      throw new HttpException(
        {
          error: "openai_compatible_rate_limited",
          message:
            "Too many OpenAI-compatible gateway requests. Retry after the current rate window.",
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
    const principal = request.authPrincipal;
    const subject = principal?.subject ?? "anonymous";
    const tenantId = principal?.tenantId ?? "tenant-unknown";
    return [tenantId, subject, this.routeKey(request)]
      .filter(Boolean)
      .join("|");
  }

  private routeKey(request: RateLimitedRequest): string {
    const method = request.method ?? "UNKNOWN";
    const path = request.originalUrl ?? request.url ?? "unknown";
    return `${method.toUpperCase()} ${path.split("?")[0]}`;
  }

  private pruneExpiredBuckets(nowMs: number): void {
    for (const [key, bucket] of this.buckets.entries()) {
      if (bucket.resetAt <= nowMs) {
        this.buckets.delete(key);
      }
    }
  }

  private safeTenant(request: RateLimitedRequest): string {
    return request.authPrincipal?.tenantId ?? "tenant-unknown";
  }

  private subjectHash(request: RateLimitedRequest): string {
    const subject = request.authPrincipal?.subject ?? "anonymous";
    return createHash("sha256").update(subject).digest("hex").slice(0, 12);
  }
}
