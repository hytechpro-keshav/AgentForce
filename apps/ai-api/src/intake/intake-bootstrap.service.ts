import {
  Injectable,
  Logger,
  ServiceUnavailableException
} from "@nestjs/common";

import { AppConfigService } from "../config/app-config.service";
import { SalesforceCaseWriteGateway } from "../salesforce/salesforce-case-write.gateway";
import type { IntakeSessionResponseDto } from "./dto/intake-otp.dto";
import { IntakeSessionService } from "./intake-session.service";

const BOOTSTRAP_EMAIL_FALLBACK = "intake-bootstrap@example.invalid";

/**
 * Mints a verified-intake JWT without OTP when email verification is
 * temporarily disabled (e.g. Salesforce daily email limits). Identity is bound
 * to a configured bootstrap Account and its primary Contact — never to
 * client-supplied account ids.
 */
@Injectable()
export class IntakeBootstrapService {
  private readonly logger = new Logger(IntakeBootstrapService.name);

  constructor(
    private readonly caseWriteGateway: SalesforceCaseWriteGateway,
    private readonly sessions: IntakeSessionService,
    private readonly config: AppConfigService
  ) {}

  async bootstrapSession(): Promise<IntakeSessionResponseDto> {
    this.ensureBootstrapAllowed();
    const accountId = this.config.customerIntake.bootstrapAccountId!;

    let resolution;
    try {
      resolution =
        await this.caseWriteGateway.resolvePrimaryContactForAccount(accountId);
    } catch (err) {
      this.logger.warn(
        `Intake bootstrap contact lookup degraded: ${(err as Error).name ?? "unknown"}`
      );
      throw new ServiceUnavailableException({
        error: "customer_intake_unavailable",
        message: "Customer intake bootstrap is not available."
      });
    }

    if (resolution.status !== "found") {
      throw new ServiceUnavailableException({
        error: "customer_intake_unavailable",
        message:
          "No contact was found for the configured bootstrap account."
      });
    }

    let verifiedEmail = resolution.email?.trim().toLowerCase();
    if (!verifiedEmail) {
      try {
        const contact = await this.caseWriteGateway.readContactSummary(
          resolution.contactId
        );
        verifiedEmail = contact.email?.trim().toLowerCase();
      } catch (err) {
        this.logger.warn(
          `Intake bootstrap contact email read degraded: ${(err as Error).name ?? "unknown"}`
        );
      }
    }

    return this.sessions.mint({
      accountId: resolution.accountId,
      contactId: resolution.contactId,
      verifiedEmail: verifiedEmail ?? BOOTSTRAP_EMAIL_FALLBACK
    });
  }

  isBootstrapAllowed(): boolean {
    const intake = this.config.customerIntake;
    return (
      intake.enabled &&
      !intake.emailVerificationEnabled &&
      Boolean(intake.bootstrapAccountId) &&
      this.caseWriteGateway.isConfigured()
    );
  }

  private ensureBootstrapAllowed(): void {
    if (!this.isBootstrapAllowed()) {
      throw new ServiceUnavailableException({
        error: "customer_intake_unavailable",
        message: "Customer intake bootstrap is not available."
      });
    }
  }
}
