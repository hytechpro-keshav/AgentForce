import { Module } from "@nestjs/common";

import { AppConfigModule } from "../config/app-config.module";
import { LlmModule } from "../llm/llm.module";
import { SalesforceModule } from "../salesforce/salesforce.module";
import { IntakeController } from "./intake.controller";
import { IntakeAgentService } from "./intake-agent.service";
import { IntakeBootstrapService } from "./intake-bootstrap.service";
import { IntakeOtpService } from "./intake-otp.service";
import { IntakeRateLimitGuard } from "./intake-rate-limit.guard";
import { IntakeService } from "./intake.service";
import { IntakeSessionService } from "./intake-session.service";

/**
 * Customer-chat guided intake: email OTP identity verification (Salesforce
 * owns code generation/verification) that mints a verified-intake JWT, plus
 * the intake context/turn/case endpoints scoped to the verified customer.
 */
@Module({
  imports: [AppConfigModule, SalesforceModule, LlmModule],
  controllers: [IntakeController],
  providers: [
    IntakeOtpService,
    IntakeBootstrapService,
    IntakeSessionService,
    IntakeAgentService,
    IntakeService,
    IntakeRateLimitGuard
  ]
})
export class IntakeModule {}
