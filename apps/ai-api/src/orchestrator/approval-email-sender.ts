import { Injectable, Logger } from "@nestjs/common";

import { AppConfigService } from "../config/app-config.service";

/** A fully-rendered, non-PII approval notification ready to deliver. */
export interface ApprovalEmailMessage {
  to: string;
  from: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Pluggable email transport seam. Concrete senders (logging, Resend, and
 * later SMTP/SendGrid) implement only delivery — the body is built and
 * sanitized by {@link GuardrailApprovalNotificationService}. `send` may
 * throw; the notification service is degrade-safe and never lets a delivery
 * failure break the graph.
 */
export interface ApprovalEmailSender {
  send(message: ApprovalEmailMessage): Promise<void>;
}

/** DI token for the configured {@link ApprovalEmailSender}. */
export const APPROVAL_EMAIL_SENDER = Symbol("APPROVAL_EMAIL_SENDER");

/**
 * Default transport — records a safe, non-PII line and delivers nothing.
 * Used when no provider is configured (or `provider=log`). Keeps the email
 * path testable and the feature degrade-safe with zero external deps.
 */
@Injectable()
export class LoggingApprovalEmailSender implements ApprovalEmailSender {
  private readonly logger = new Logger(LoggingApprovalEmailSender.name);

  async send(message: ApprovalEmailMessage): Promise<void> {
    // The subject is a fixed, non-PII template (no Case text or names).
    this.logger.log(
      `Approval email (log transport) to ${message.to}: "${message.subject}"`
    );
  }
}

/**
 * Resend HTTPS transport — a single POST to the Resend API. No vendor SDK:
 * uses global `fetch` so the AI API takes on no new dependency, and provider
 * switching stays in configuration (AGENTS.md). SendGrid or SMTP can be added
 * as sibling senders behind {@link ApprovalEmailSender} without touching the
 * graph or the notification service.
 */
@Injectable()
export class ResendApprovalEmailSender implements ApprovalEmailSender {
  private static readonly ENDPOINT = "https://api.resend.com/emails";

  constructor(private readonly config: AppConfigService) {}

  async send(message: ApprovalEmailMessage): Promise<void> {
    const apiKey = this.config.orchestrator.guardrailApproval.resendApiKey;
    if (!apiKey) {
      throw new Error("Resend API key is not configured.");
    }
    const response = await fetch(ResendApprovalEmailSender.ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        from: message.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text
      })
    });
    if (!response.ok) {
      // Do not include the response body — it can echo the recipient address.
      throw new Error(`Resend API responded ${response.status}.`);
    }
  }
}
