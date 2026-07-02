import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";

import { AppConfigService } from "../config/app-config.service";
import { SalesforceCaseWriteGateway } from "../salesforce/salesforce-case-write.gateway";
import { SalesforceOtpGateway } from "../salesforce/salesforce-otp.gateway";
import type {
  IntakeSessionResponseDto,
  OtpRequestDto,
  OtpRequestResponseDto,
  OtpVerifyDto
} from "./dto/intake-otp.dto";
import { IntakeSessionService } from "./intake-session.service";

const UNIFORM_REQUEST_MESSAGE =
  "If this email matches an account, a verification code has been sent.";

/**
 * Orchestrates the customer-chat OTP flow:
 *  - request: resolve the email to a known Contact and, only then, ask
 *    Salesforce to send a code — always returning a uniform response so the
 *    endpoint never reveals whether an email maps to an account,
 *  - verify: verify the code with Salesforce and, on success, mint a
 *    verified-intake JWT carrying the resolved accountId/contactId.
 *
 * Known-customers-only: unknown or ambiguous emails never receive a code and
 * can never verify. All failure paths return a uniform message.
 */
@Injectable()
export class IntakeOtpService {
  private readonly logger = new Logger(IntakeOtpService.name);

  constructor(
    private readonly otpGateway: SalesforceOtpGateway,
    private readonly caseWriteGateway: SalesforceCaseWriteGateway,
    private readonly sessions: IntakeSessionService,
    private readonly config: AppConfigService
  ) {}

  async requestOtp(dto: OtpRequestDto): Promise<OtpRequestResponseDto> {
    this.ensureEnabled();
    const email = dto.email.trim().toLowerCase();

    let known = false;
    try {
      const resolution =
        await this.caseWriteGateway.resolveContactByEmailGlobal(email);
      known = resolution.status === "found";
    } catch (err) {
      // Never leak lookup failures; treat as unknown and stay uniform.
      this.logger.warn(
        `Intake OTP contact lookup degraded: ${(err as Error).name ?? "unknown"}`
      );
    }

    if (known) {
      // generate() degrades internally; the outcome is intentionally ignored
      // so the response is identical for sent / rate-limited / degraded.
      await this.otpGateway.generate(email, dto.correlationId);
    }

    return { status: "sent", message: UNIFORM_REQUEST_MESSAGE };
  }

  async verifyOtp(dto: OtpVerifyDto): Promise<IntakeSessionResponseDto> {
    this.ensureEnabled();
    const email = dto.email.trim().toLowerCase();

    const verification = await this.otpGateway.verify(
      email,
      dto.code,
      dto.correlationId
    );
    if (!verification.valid) {
      throw new UnauthorizedException({
        error: "otp_verification_failed",
        message: "That verification code is invalid or has expired."
      });
    }

    // Re-resolve identity server-side; never trust a client-supplied account.
    let accountId: string | undefined;
    let contactId: string | undefined;
    try {
      const resolution =
        await this.caseWriteGateway.resolveContactByEmailGlobal(email);
      if (resolution.status === "found") {
        accountId = resolution.accountId;
        contactId = resolution.contactId;
      }
    } catch (err) {
      this.logger.warn(
        `Intake identity resolution degraded: ${(err as Error).name ?? "unknown"}`
      );
    }

    if (!accountId || !contactId) {
      // Fail closed: a verified code with no resolvable account is not a
      // usable identity.
      throw new UnauthorizedException({
        error: "otp_verification_failed",
        message: "That verification code is invalid or has expired."
      });
    }

    return this.sessions.mint({
      accountId,
      contactId,
      verifiedEmail: email,
      locale: dto.locale
    });
  }

  isEmailVerificationEnabled(): boolean {
    return (
      this.config.customerIntake.enabled &&
      this.config.customerIntake.emailVerificationEnabled &&
      this.otpGateway.isConfigured()
    );
  }

  private ensureEnabled(): void {
    if (
      !this.config.customerIntake.enabled ||
      !this.otpGateway.isConfigured()
    ) {
      throw new ServiceUnavailableException({
        error: "customer_intake_unavailable",
        message: "Customer intake is not available."
      });
    }
  }
}
