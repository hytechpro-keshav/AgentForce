import { BadRequestException, Controller, Get, Param } from "@nestjs/common";

import { RequireScopes } from "./require-scopes.decorator";
import {
  TenantOperationsService,
  type SalesforceSetupInstructions
} from "./tenant-operations.service";
import type { TenantOperationsReport } from "./tenant-registry.service";

const SAFE_TENANT_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

@Controller("admin/tenants")
@RequireScopes("tenant:admin")
export class TenantOperationsController {
  constructor(private readonly tenantOperations: TenantOperationsService) {}

  @Get("report")
  async listReports(): Promise<{ tenants: TenantOperationsReport[] }> {
    return this.tenantOperations.listTenantReports();
  }

  @Get(":tenantId/report")
  async getReport(
    @Param("tenantId") tenantId: string
  ): Promise<TenantOperationsReport> {
    return this.tenantOperations.getTenantReport(this.safeTenantId(tenantId));
  }

  @Get(":tenantId/salesforce-setup")
  async getSalesforceSetup(
    @Param("tenantId") tenantId: string
  ): Promise<SalesforceSetupInstructions> {
    return this.tenantOperations.getSalesforceSetupInstructions(
      this.safeTenantId(tenantId)
    );
  }

  private safeTenantId(tenantId: string): string {
    if (!SAFE_TENANT_ID.test(tenantId)) {
      throw new BadRequestException({
        error: "invalid_tenant_id",
        message: "Tenant id must use safe identifier characters."
      });
    }
    return tenantId;
  }
}
