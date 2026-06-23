import { Module } from "@nestjs/common";

import { AppConfigModule } from "../config/app-config.module";
import { SalesforceModule } from "../salesforce/salesforce.module";
import { DemoCaseCreateController } from "./demo-case-create.controller";
import { DemoCaseCreateService } from "./demo-case-create.service";

@Module({
  imports: [AppConfigModule, SalesforceModule],
  controllers: [DemoCaseCreateController],
  providers: [DemoCaseCreateService]
})
export class DemoCaseCreateModule {}
