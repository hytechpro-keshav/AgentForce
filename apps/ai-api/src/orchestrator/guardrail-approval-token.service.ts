import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { randomUUID } from "crypto";
import * as jwt from "jsonwebtoken";

import { AppConfigService } from "../config/app-config.service";
import {
  APPROVAL_DECISIONS,
  type ApproverResumeDecision
} from "./dto/case-triage-lifecycle";

const APPROVAL_TOKEN_ISSUER = "agentforce-orchestrator";
const APPROVAL_TOKEN_AUDIENCE = "guardrail-approval";

/** Verified claims from a guardrail approve/reject link token. No PII. */
export interface GuardrailApprovalTokenClaims {
  workflowId: string;
  decision: ApproverResumeDecision;
  /**
   * JWT id — reused as the resume `idempotencyKey` so a replayed click (or a
   * prefetch + confirm) resolves the workflow once. A UUID, which satisfies
   * the resume request-id pattern.
   */
  jti: string;
}

/**
 * Phase 6b — mints and verifies the short-lived, scoped tokens embedded in
 * the approve/reject links of a guardrail approval email.
 *
 * Each token binds exactly one workflow + one decision and is signed with
 * `ORCHESTRATOR_APPROVAL_TOKEN_SECRET` — deliberately separate from
 * `AI_API_JWT_SECRET` so a leaked link can never be replayed as an API
 * credential. The payload carries NO PII: workflow id (`sub`), the decision,
 * and a random `jti` only. `escalated` is never mintable — only the
 * approver-submittable `APPROVAL_DECISIONS` are accepted (phase plan R6).
 */
@Injectable()
export class GuardrailApprovalTokenService {
  private readonly logger = new Logger(GuardrailApprovalTokenService.name);

  constructor(private readonly config: AppConfigService) {}

  /** True when a signing secret is configured (links can be minted/verified). */
  isEnabled(): boolean {
    return Boolean(this.config.orchestrator.guardrailApproval.tokenSecret);
  }

  /**
   * Mints a signed approve/reject link token. Throws when no secret is
   * configured — callers gate on {@link isEnabled} (config requires the secret
   * whenever email routing is on, so the notification service only mints then).
   */
  mint(workflowId: string, decision: ApproverResumeDecision): string {
    const { tokenSecret, tokenTtlSeconds } =
      this.config.orchestrator.guardrailApproval;
    if (!tokenSecret) {
      throw new Error("Approval token secret is not configured.");
    }
    return jwt.sign({ decision }, tokenSecret, {
      algorithm: "HS256",
      subject: workflowId,
      jwtid: randomUUID(),
      issuer: APPROVAL_TOKEN_ISSUER,
      audience: APPROVAL_TOKEN_AUDIENCE,
      expiresIn: tokenTtlSeconds
    });
  }

  /**
   * Verifies a link token and returns its claims. Throws
   * `UnauthorizedException` on any failure (bad signature, expired, wrong
   * issuer/audience, missing/invalid decision) so the public approve/reject
   * routes answer a uniform 401 without leaking the reason.
   */
  verify(token: string): GuardrailApprovalTokenClaims {
    const { tokenSecret } = this.config.orchestrator.guardrailApproval;
    if (!tokenSecret) {
      throw new UnauthorizedException({ error: "approval_link_disabled" });
    }
    let payload: jwt.JwtPayload;
    try {
      const verified = jwt.verify(token, tokenSecret, {
        algorithms: ["HS256"],
        issuer: APPROVAL_TOKEN_ISSUER,
        audience: APPROVAL_TOKEN_AUDIENCE
      });
      if (typeof verified === "string") {
        throw new Error("unexpected string payload");
      }
      payload = verified;
    } catch (err) {
      // Never log the token; log only the error class.
      this.logger.warn(
        `Approval token verification failed: ${
          (err as Error).name ?? "unknown"
        }`
      );
      throw new UnauthorizedException({ error: "invalid_approval_token" });
    }

    const workflowId = typeof payload.sub === "string" ? payload.sub : "";
    const decision = payload["decision"];
    const jti = typeof payload.jti === "string" ? payload.jti : "";
    if (
      !workflowId ||
      !jti ||
      typeof decision !== "string" ||
      !(APPROVAL_DECISIONS as readonly string[]).includes(decision)
    ) {
      throw new UnauthorizedException({ error: "invalid_approval_token" });
    }
    return {
      workflowId,
      decision: decision as ApproverResumeDecision,
      jti
    };
  }
}
