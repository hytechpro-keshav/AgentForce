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
/**
 * Distinct audience for 6b+ Salesforce-Approval callback tokens. A different
 * audience than the email links means an SF callback token can never be
 * replayed at the public email `/approve` endpoint (and vice versa), and the
 * token is deliberately decision-AGNOSTIC: the approve/reject decision comes
 * from the approver's action in Salesforce, presented on the callback body.
 */
const SF_APPROVAL_TOKEN_AUDIENCE = "guardrail-sf-approval";

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
 * Verified claims from a Salesforce-Approval callback token (6b+). No PII and
 * NO decision — the decision is supplied by Salesforce and validated by the
 * callback endpoint against the approver-submittable set.
 */
export interface GuardrailSalesforceApprovalTokenClaims {
  workflowId: string;
  /** JWT id — reused as the resume `idempotencyKey` (one resolve per submit). */
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
   * Mints a decision-agnostic Salesforce-Approval callback token (6b+). Bound
   * to one workflow with a distinct audience; the Apex submit stamps it on the
   * Case so the approval-completion Flow can authenticate its resume callout.
   * Throws when no secret is configured — config requires the secret whenever
   * SF approval routing is on, so the notification service only mints then.
   */
  mintForSalesforce(workflowId: string): string {
    const { tokenSecret, tokenTtlSeconds } =
      this.config.orchestrator.guardrailApproval;
    if (!tokenSecret) {
      throw new Error("Approval token secret is not configured.");
    }
    return jwt.sign({}, tokenSecret, {
      algorithm: "HS256",
      subject: workflowId,
      jwtid: randomUUID(),
      issuer: APPROVAL_TOKEN_ISSUER,
      audience: SF_APPROVAL_TOKEN_AUDIENCE,
      expiresIn: tokenTtlSeconds
    });
  }

  /**
   * Verifies a Salesforce-Approval callback token and returns its claims
   * (workflow id + jti, NO decision). Throws `UnauthorizedException` on any
   * failure so the public callback route answers a uniform 401 without
   * leaking the reason.
   */
  verifyForSalesforce(token: string): GuardrailSalesforceApprovalTokenClaims {
    const { tokenSecret } = this.config.orchestrator.guardrailApproval;
    if (!tokenSecret) {
      throw new UnauthorizedException({ error: "approval_link_disabled" });
    }
    let payload: jwt.JwtPayload;
    try {
      const verified = jwt.verify(token, tokenSecret, {
        algorithms: ["HS256"],
        issuer: APPROVAL_TOKEN_ISSUER,
        audience: SF_APPROVAL_TOKEN_AUDIENCE
      });
      if (typeof verified === "string") {
        throw new Error("unexpected string payload");
      }
      payload = verified;
    } catch (err) {
      this.logger.warn(
        `SF approval token verification failed: ${
          (err as Error).name ?? "unknown"
        }`
      );
      throw new UnauthorizedException({ error: "invalid_approval_token" });
    }
    const workflowId = typeof payload.sub === "string" ? payload.sub : "";
    const jti = typeof payload.jti === "string" ? payload.jti : "";
    if (!workflowId || !jti) {
      throw new UnauthorizedException({ error: "invalid_approval_token" });
    }
    return { workflowId, jti };
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
