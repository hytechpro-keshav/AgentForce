import { Module } from "@nestjs/common";

import { AppConfigModule } from "../config/app-config.module";
import { SalesforceAuthService } from "./salesforce-auth.service";
import { SalesforceCaseGateway } from "./salesforce-case.gateway";
import { SalesforceCustomerGateway } from "./salesforce-customer.gateway";
import { SalesforceFulfillmentGateway } from "./salesforce-fulfillment.gateway";
import { SalesforceInventoryGateway } from "./salesforce-inventory.gateway";
import { SalesforceSchedulingGateway } from "./salesforce-scheduling.gateway";

/**
 * Outbound Salesforce connectivity for the orchestrator. Exposes the
 * Case gateway (read + gated write), the read-only customer gateway
 * (Node 2), the read-only inventory gateway (Node 4 read/plan), the
 * Phase 4c fulfillment gateway (gated writes after approval), and the
 * read-only Field Service scheduling gateway (Node 5 read/plan); the auth
 * service is an internal detail.
 */
@Module({
  imports: [AppConfigModule],
  providers: [
    SalesforceAuthService,
    SalesforceCaseGateway,
    SalesforceCustomerGateway,
    SalesforceInventoryGateway,
    SalesforceFulfillmentGateway,
    SalesforceSchedulingGateway
  ],
  exports: [
    SalesforceCaseGateway,
    SalesforceCustomerGateway,
    SalesforceInventoryGateway,
    SalesforceFulfillmentGateway,
    SalesforceSchedulingGateway,
    SalesforceAuthService
  ]
})
export class SalesforceModule {}
