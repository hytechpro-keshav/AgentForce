import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import { createHash, randomUUID, timingSafeEqual } from "crypto";
import * as jwt from "jsonwebtoken";

import { AppConfigService } from "../config/app-config.service";
import type {
  OperatorOrchestrationSessionRequestDto,
  OperatorOrchestrationSessionResponseDto
} from "./dto/operator-orchestration-session.dto";

/**
 * RC-8a (Node 6 6c) — mints the operator console session.
 *
 * A shared access code mints a short-TTL JWT carrying BOTH
 * `agentforce:orchestrator-read` and `agentforce:orchestrator-control` so the
 * console can read status AND issue Stop AI. The token is returned to the
 * trusted Next.js console (BFF), which stores it as an httpOnly cookie and
 * attaches it server-side on the stop proxy.
 *
 * `agentforce:orchestrator-approval` is NEVER granted here — Stop AI is not a
 * guardrail approve/reject. Fail closed: login is unavailable until the access
 * code (and JWT secret) are configured.
 */
@Injectable()
export class OperatorOrchestrationSessionService {
  /** Read + control, never approval (Node 6 6c plan §1.1, §5.4). */
  static readonly SCOPES =
    "agentforce:orchestrator-read agentforce:orchestrator-control";

  private readonly logger = new Logger(
    OperatorOrchestrationSessionService.name
  );

  constructor(private readonly config: AppConfigService) {}

  createSession(
    request: OperatorOrchestrationSessionRequestDto,
    clientKey: string
  ): OperatorOrchestrationSessionResponseDto {
    const { accessCode, ttlSeconds } = this.config.operatorOrchestrationSession;
    const { secret, issuer, audience } = this.config.jwt;

    if (!accessCode || !secret) {
      throw new ServiceUnavailableException({
        error: "operator_orchestration_login_unavailable",
        message: "Operator console login is not configured."
      });
    }

    if (
      !OperatorOrchestrationSessionService.matchesAccessCode(
        request.accessCode,
        accessCode
      )
    ) {
      this.logger.warn(
        `Operator console login rejected clientHash=${this.clientHash(clientKey)}`
      );
      throw new UnauthorizedException({
        error: "operator_orchestration_login_failed",
        message: "Invalid access code."
      });
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const expiresAtSeconds = nowSeconds + ttlSeconds;
    const subject = `operator-console:${randomUUID()}`;
    const payload: jwt.JwtPayload = {
      sub: subject,
      scope: OperatorOrchestrationSessionService.SCOPES,
      roles: ["operator"],
      channel: "orchestration-console",
      iat: nowSeconds,
      exp: expiresAtSeconds
    };

    const accessToken = jwt.sign(payload, secret, {
      algorithm: "HS256",
      ...(issuer ? { issuer } : {}),
      ...(audience ? { audience } : {})
    });

    return {
      accessToken,
      tokenType: "Bearer",
      expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
      expiresInSeconds: ttlSeconds,
      subject,
      scope: OperatorOrchestrationSessionService.SCOPES
    };
  }

  private static matchesAccessCode(input: string, expected: string): boolean {
    return timingSafeEqual(
      OperatorOrchestrationSessionService.sha256(input.trim()),
      OperatorOrchestrationSessionService.sha256(expected)
    );
  }

  private static sha256(value: string): Buffer {
    return createHash("sha256").update(value, "utf8").digest();
  }

  private clientHash(clientKey: string): string {
    return createHash("sha256").update(clientKey).digest("hex").slice(0, 12);
  }
}
