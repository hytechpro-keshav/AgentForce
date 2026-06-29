import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { AppConfigModule } from "../config/app-config.module";
import { SalesforceModule } from "../salesforce/salesforce.module";
import { DemoCaseCreateController } from "./demo-case-create.controller";
import { DemoCaseCreateService } from "./demo-case-create.service";

@Module({
  imports: [AppConfigModule, SalesforceModule, AuthModule],
  controllers: [DemoCaseCreateController],
  providers: [DemoCaseCreateService]
})
export class DemoCaseCreateModule {}
