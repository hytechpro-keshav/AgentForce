import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException
} from "@nestjs/common";

import type { AuthPrincipal } from "../auth/jwt-auth.guard";
import { AppConfigService } from "../config/app-config.service";
import {
  SalesforceCaseWriteGateway,
  type AccountContext,
  type ContactSummary,
  type IntakeDevice
} from "../salesforce/salesforce-case-write.gateway";
import { SalesforceGatewayError } from "../salesforce/salesforce-gateway.error";
import type { IntakeContextResponseDto } from "./dto/intake-context.dto";
import type {
  IntakeCaseCreateDto,
  IntakeCaseResponseDto
} from "./dto/intake-case.dto";
import { requireIntakeIdentity } from "./intake-claims";

/**
 * Verified-intake reads + chat-driven Case create. All Salesforce access is
 * scoped to the token's verified accountId/contactId; the client never
 * supplies an Account. The device chosen at create time is re-checked to
 * belong to the verified Account before it is attached to the Case.
 */
@Injectable()
export class IntakeService {
  private readonly logger = new Logger(IntakeService.name);

  constructor(
    private readonly caseWriteGateway: SalesforceCaseWriteGateway,
    private readonly config: AppConfigService
  ) {}

  async getContext(
    principal: AuthPrincipal | undefined
  ): Promise<IntakeContextResponseDto> {
    this.ensureEnabled();
    const identity = requireIntakeIdentity(principal);

    const [contact, account, assets] = await Promise.all([
      this.caseWriteGateway
        .readContactSummary(identity.contactId)
        .catch((err) => this.degradeContact(err)),
      this.caseWriteGateway
        .readAccountContext(identity.accountId)
        .catch((err) => this.degradeAccount(err)),
      this.caseWriteGateway
        .listAccountAssets(identity.accountId)
        .catch((err) => {
          this.logger.warn(`Intake asset list degraded: ${this.kind(err)}`);
          return [];
        })
    ]);

    const shipTo = {
      city: account.shipToCity,
      state: account.shipToState,
      country: account.shipToCountry
    };
    const billingLocation = {
      city: account.billingCity,
      state: account.billingState,
      country: account.billingCountry
    };
    const hasMultipleServiceLocations = IntakeService.hasDistinctLocations(
      shipTo,
      billingLocation
    );

    return {
      displayName: contact.name,
      accountName: account.accountName,
      contactEmail: identity.verifiedEmail ?? contact.email,
      // Serial numbers stay server-side; only id + friendly label reach the UI.
      devices: assets.map((device) => ({
        assetId: device.assetId,
        label: device.label,
        product: device.product
      })),
      shipTo,
      ...(hasMultipleServiceLocations ? { billingLocation } : {}),
      hasMultipleServiceLocations
    };
  }

  async createCase(
    principal: AuthPrincipal | undefined,
    dto: IntakeCaseCreateDto
  ): Promise<IntakeCaseResponseDto> {
    this.ensureEnabled();
    const identity = requireIntakeIdentity(principal);

    const assets = await this.caseWriteGateway
      .listAccountAssets(identity.accountId)
      .catch((err) => {
        this.logger.warn(`Intake asset list degraded: ${this.kind(err)}`);
        return [] as IntakeDevice[];
      });

    const assetId = await this.resolveCaseAssetId(
      identity.accountId,
      assets,
      dto.assetId,
      dto.deviceLabel
    );

    const [account, contact] = await Promise.all([
      this.caseWriteGateway
        .readAccountContext(identity.accountId)
        .catch((err) => this.degradeAccount(err)),
      this.caseWriteGateway
        .readContactSummary(identity.contactId)
        .catch((err) => this.degradeContact(err))
    ]);

    const subject =
      dto.subject?.trim() || IntakeService.deriveSubject(dto.issueDescription);

    try {
      return await this.caseWriteGateway.createChatCase({
        subject,
        description: dto.issueDescription,
        priority: dto.priority ?? "Medium",
        accountId: identity.accountId,
        contactId: identity.contactId,
        assetId,
        suppliedName: contact.name,
        suppliedEmail: identity.verifiedEmail ?? contact.email,
        serviceShipToCity: dto.shipTo?.city ?? account.shipToCity,
        serviceShipToState: dto.shipTo?.state ?? account.shipToState,
        serviceShipToCountry: dto.shipTo?.country ?? account.shipToCountry
      });
    } catch (err) {
      throw this.mapError(err);
    }
  }

  private ensureEnabled(): void {
    if (
      !this.config.customerIntake.enabled ||
      !this.caseWriteGateway.isConfigured()
    ) {
      throw new ServiceUnavailableException({
        error: "customer_intake_unavailable",
        message: "Customer intake is not available."
      });
    }
  }

  private mapError(err: unknown): Error {
    if (err instanceof SalesforceGatewayError && err.kind === "not_found") {
      return new NotFoundException({
        error: "not_found",
        message: "The requested Salesforce record was not found."
      });
    }
    this.logger.warn(`Intake case create degraded: ${this.kind(err)}`);
    return new BadGatewayException({
      error: "case_create_failed",
      message: "We could not create the case right now. Please try again."
    });
  }

  private degradeAccount(err: unknown): AccountContext {
    this.logger.warn(`Intake account read degraded: ${this.kind(err)}`);
    return {};
  }

  private degradeContact(err: unknown): ContactSummary {
    this.logger.warn(`Intake contact read degraded: ${this.kind(err)}`);
    return {};
  }

  private kind(err: unknown): string {
    return err instanceof SalesforceGatewayError
      ? err.kind
      : ((err as Error)?.name ?? "unexpected");
  }

  private static deriveSubject(description: string): string {
    const firstLine = description.trim().split(/\r?\n/)[0] ?? "";
    const subject = firstLine.slice(0, 120).trim();
    return subject.length > 0 ? subject : "Laptop support request";
  }

  private static hasDistinctLocations(
    shipTo: { city?: string; state?: string; country?: string },
    billing: { city?: string; state?: string; country?: string }
  ): boolean {
    const shipKey = IntakeService.locationKey(shipTo);
    const billingKey = IntakeService.locationKey(billing);
    if (!shipKey || !billingKey) {
      return false;
    }
    return shipKey !== billingKey;
  }

  private static locationKey(location: {
    city?: string;
    state?: string;
    country?: string;
  }): string {
    return [location.city, location.state, location.country]
      .map((part) => part?.trim().toLowerCase() ?? "")
      .filter(Boolean)
      .join("|");
  }

  private async resolveCaseAssetId(
    accountId: string,
    assets: IntakeDevice[],
    requestedAssetId?: string,
    deviceLabel?: string
  ): Promise<string | undefined> {
    if (assets.length === 0) {
      return undefined;
    }

    if (requestedAssetId) {
      try {
        const owned = await this.caseWriteGateway.assetBelongsToAccount(
          requestedAssetId,
          accountId
        );
        if (!owned) {
          throw new ForbiddenException({
            error: "asset_not_owned",
            message: "The selected device is not on your account."
          });
        }
        return requestedAssetId;
      } catch (err) {
        if (err instanceof ForbiddenException) {
          throw err;
        }
        throw this.mapError(err);
      }
    }

    const fallbackCandidates = [
      assets.length === 1 ? assets[0]?.assetId : undefined,
      IntakeService.matchDeviceLabel(assets, deviceLabel)
    ].filter((value): value is string => Boolean(value));

    for (const candidate of fallbackCandidates) {
      try {
        const owned = await this.caseWriteGateway.assetBelongsToAccount(
          candidate,
          accountId
        );
        if (owned) {
          return candidate;
        }
      } catch (err) {
        throw this.mapError(err);
      }
    }

    throw new BadRequestException({
      error: "device_required",
      message:
        "Select the affected device from your account before submitting the case."
    });
  }

  private static matchDeviceLabel(
    assets: IntakeDevice[],
    deviceLabel?: string
  ): string | undefined {
    const normalized = deviceLabel?.trim().toLowerCase();
    if (!normalized) {
      return undefined;
    }
    const exact = assets.find(
      (device) => device.label.trim().toLowerCase() === normalized
    );
    if (exact) {
      return exact.assetId;
    }
    const partial = assets.find((device) =>
      device.label.toLowerCase().includes(normalized)
    );
    return partial?.assetId;
  }
}
