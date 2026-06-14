import { Module } from "@nestjs/common";

import { AppConfigModule } from "../config/app-config.module";
import { SalesforceAuthService } from "./salesforce-auth.service";
import { SalesforceCaseGateway } from "./salesforce-case.gateway";
import { SalesforceCustomerGateway } from "./salesforce-customer.gateway";
import { SalesforceInventoryGateway } from "./salesforce-inventory.gateway";

/**
 * Outbound Salesforce connectivity for the orchestrator. Exposes the
 * Case gateway (read + gated write), the read-only customer gateway
 * (Node 2), and the read-only inventory gateway (Node 4); the auth
 * service is an internal detail.
 */
@Module({
  imports: [AppConfigModule],
  providers: [
    SalesforceAuthService,
    SalesforceCaseGateway,
    SalesforceCustomerGateway,
    SalesforceInventoryGateway
  ],
  exports: [
    SalesforceCaseGateway,
    SalesforceCustomerGateway,
    SalesforceInventoryGateway,
    SalesforceAuthService
  ]
})
export class SalesforceModule {}
