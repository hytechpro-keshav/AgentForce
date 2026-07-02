import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";

import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { Public } from "../auth/public.decorator";
import { RequireScopes } from "../auth/require-scopes.decorator";
import type { IntakeContextResponseDto } from "./dto/intake-context.dto";
import {
  IntakeCaseCreateDto,
  type IntakeCaseResponseDto
} from "./dto/intake-case.dto";
import {
  IntakeTurnRequestDto,
  type IntakeTurnResponseDto
} from "./dto/intake-turn.dto";
import {
  OtpRequestDto,
  OtpVerifyDto,
  type IntakeSessionResponseDto,
  type OtpRequestResponseDto
} from "./dto/intake-otp.dto";
import { IntakeAgentService } from "./intake-agent.service";
import { IntakeOtpService } from "./intake-otp.service";
import { IntakeRateLimitGuard } from "./intake-rate-limit.guard";
import { IntakeService } from "./intake.service";

/**
 * Customer-intake endpoints.
 *  - OTP request/verify are public (no token yet) but rate-limited; verify
 *    returns the verified-intake JWT.
 *  - context/turn/case require the `chat:intake` scope and are bound to the
 *    verified identity carried in that JWT.
 */
@Controller("intake")
export class IntakeController {
  constructor(
    private readonly otp: IntakeOtpService,
    private readonly agent: IntakeAgentService,
    private readonly intake: IntakeService
  ) {}

  @Public()
  @UseGuards(IntakeRateLimitGuard)
  @HttpCode(200)
  @Post("otp/request")
  requestOtp(@Body() body: OtpRequestDto): Promise<OtpRequestResponseDto> {
    return this.otp.requestOtp(body);
  }

  @Public()
  @UseGuards(IntakeRateLimitGuard)
  @HttpCode(200)
  @Post("otp/verify")
  verifyOtp(@Body() body: OtpVerifyDto): Promise<IntakeSessionResponseDto> {
    return this.otp.verifyOtp(body);
  }

  @RequireScopes("chat:intake")
  @UseGuards(IntakeRateLimitGuard)
  @Get("context")
  getContext(
    @Req() request: AuthenticatedRequest
  ): Promise<IntakeContextResponseDto> {
    return this.intake.getContext(request.authPrincipal);
  }

  @RequireScopes("chat:intake")
  @UseGuards(IntakeRateLimitGuard)
  @HttpCode(200)
  @Post("turn")
  turn(
    @Body() body: IntakeTurnRequestDto,
    @Req() request: AuthenticatedRequest
  ): Promise<IntakeTurnResponseDto> {
    return this.agent.nextTurn(request.authPrincipal, body);
  }

  @RequireScopes("chat:intake")
  @UseGuards(IntakeRateLimitGuard)
  @HttpCode(201)
  @Post("case")
  createCase(
    @Body() body: IntakeCaseCreateDto,
    @Req() request: AuthenticatedRequest
  ): Promise<IntakeCaseResponseDto> {
    return this.intake.createCase(request.authPrincipal, body);
  }
}
