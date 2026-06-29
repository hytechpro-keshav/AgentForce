import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException
} from "@nestjs/common";

import {
  findScenarioById,
  loadDemoCaseScenarioCatalog
} from "./demo-case-catalog";
import type {
  DemoCaseCreateDto,
  DemoCaseCreateResponseDto,
  DemoCaseFormDto,
  DemoCaseOverridesDto
} from "./dto/demo-case-create.dto";
import { SalesforceCaseWriteGateway } from "../salesforce/salesforce-case-write.gateway";
import { SalesforceGatewayError } from "../salesforce/salesforce-gateway.error";
import { buildSalesforceCaseRecordUrl } from "../salesforce/salesforce-lightning-url";

@Injectable()
export class DemoCaseCreateService {
  private readonly logger = new Logger(DemoCaseCreateService.name);

  constructor(private readonly gateway: SalesforceCaseWriteGateway) {}

  isReady(): boolean {
    return this.gateway.isConfigured();
  }

  async create(
    dto: DemoCaseCreateDto
  ): Promise<DemoCaseCreateResponseDto> {
    const form = this.resolveForm(dto);
    const accountId = await this.gateway.resolveAccountByName(
      form.accountLookup.name
    );
    if (!accountId) {
      throw new NotFoundException({
        error: "lookup_not_found",
        message: `Account not found: ${form.accountLookup.name}`
      });
    }

    const asset = await this.gateway.resolveAssetBySerial(
      form.assetLookup.serialNumber
    );
    if (!asset) {
      throw new NotFoundException({
        error: "lookup_not_found",
        message: `Asset not found: ${form.assetLookup.serialNumber}`
      });
    }

    let contactId: string | undefined;
    if (form.contactLookup?.email) {
      contactId = await this.gateway.resolveContactByEmail(
        accountId,
        form.contactLookup.email
      );
    }

    try {
      const result = await this.gateway.createCase({
        subject: form.subject,
        description: form.description,
        status: form.status,
        origin: form.origin,
        priority: form.priority,
        accountId,
        contactId,
        assetId: asset.assetId,
        suppliedName: form.suppliedName,
        suppliedEmail: form.suppliedEmail,
        serviceShipToCity: form.shipTo.city,
        serviceShipToState: form.shipTo.state,
        serviceShipToCountry: form.shipTo.country
      });

      this.logger.log(
        `Demo Case created scenarioId=${dto.scenarioId ?? "custom"} caseId=${result.caseId}`
      );

      return {
        caseId: result.caseId,
        caseNumber: result.caseNumber,
        salesforceCaseUrl: buildSalesforceCaseRecordUrl(result.caseId),
        orchestrationUrl: `/orchestration?caseId=${encodeURIComponent(
          result.caseId
        )}`
      };
    } catch (error) {
      if (error instanceof SalesforceGatewayError) {
        if (error.kind === "not_found") {
          throw new NotFoundException({
            error: "lookup_not_found",
            message: error.message
          });
        }
        throw new BadRequestException({
          error: "validation_error",
          message: error.message
        });
      }
      throw error;
    }
  }

  private resolveForm(dto: DemoCaseCreateDto): DemoCaseFormDto {
    if (dto.form) {
      return dto.form;
    }

    if (!dto.scenarioId) {
      throw new BadRequestException({
        error: "validation_error",
        message: "Provide scenarioId or form."
      });
    }

    if (dto.scenarioId === "custom") {
      throw new BadRequestException({
        error: "validation_error",
        message: "Custom scenarios require an explicit form payload."
      });
    }

    const scenario = findScenarioById(dto.scenarioId);
    if (!scenario) {
      const knownIds = loadDemoCaseScenarioCatalog()
        .scenarios.map((entry) => entry.id)
        .join(", ");
      throw new BadRequestException({
        error: "invalid_scenario",
        message: `Unknown scenarioId: ${dto.scenarioId}. Known: ${knownIds}`
      });
    }

    return this.mergeForm(scenario.form, dto.overrides);
  }

  private mergeForm(
    base: DemoCaseFormDto,
    overrides?: DemoCaseOverridesDto
  ): DemoCaseFormDto {
    if (!overrides) {
      return { ...base };
    }
    return {
      ...base,
      ...overrides,
      accountLookup: overrides.accountLookup ?? base.accountLookup,
      contactLookup: overrides.contactLookup ?? base.contactLookup,
      assetLookup: overrides.assetLookup ?? base.assetLookup,
      shipTo: overrides.shipTo
        ? { ...base.shipTo, ...overrides.shipTo }
        : base.shipTo
    };
  }
}
