import { Module } from "@nestjs/common";

import { AppConfigModule } from "../config/app-config.module";
import { SalesforceAuthService } from "./salesforce-auth.service";
import { SalesforceCaseGateway } from "./salesforce-case.gateway";
import { SalesforceCustomerGateway } from "./salesforce-customer.gateway";

/**
 * Outbound Salesforce connectivity for the orchestrator. Exposes the
 * Case gateway (read + gated write) and the read-only customer gateway
 * (Node 2); the auth service is an internal detail.
 */
@Module({
  imports: [AppConfigModule],
  providers: [
    SalesforceAuthService,
    SalesforceCaseGateway,
    SalesforceCustomerGateway
  ],
  exports: [
    SalesforceCaseGateway,
    SalesforceCustomerGateway,
    SalesforceAuthService
  ]
})
export class SalesforceModule {}
