import { Module } from "@nestjs/common";

import { AppConfigModule } from "../config/app-config.module";
import { SalesforceAuthService } from "./salesforce-auth.service";
import { SalesforceCaseGateway } from "./salesforce-case.gateway";

/**
 * Outbound Salesforce connectivity for the orchestrator. Exposes a
 * single Case gateway; the auth service is an internal detail.
 */
@Module({
  imports: [AppConfigModule],
  providers: [SalesforceAuthService, SalesforceCaseGateway],
  exports: [SalesforceCaseGateway, SalesforceAuthService]
})
export class SalesforceModule {}
