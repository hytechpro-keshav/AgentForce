import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException
} from "@nestjs/common";
import { createHash, randomUUID, timingSafeEqual } from "crypto";
import * as jwt from "jsonwebtoken";

import { AppConfigService } from "../config/app-config.service";
import type {
  CustomerChatSessionRequestDto,
  CustomerChatSessionResponseDto
} from "./dto/customer-chat-session.dto";

@Injectable()
export class CustomerChatSessionService {
  private readonly logger = new Logger(CustomerChatSessionService.name);

  constructor(private readonly config: AppConfigService) {}

  createSession(
    request: CustomerChatSessionRequestDto,
    clientKey: string
  ): CustomerChatSessionResponseDto {
    const { accessCode, ttlSeconds } = this.config.customerChatSession;
    const { secret, issuer, audience } = this.config.jwt;

    if (!accessCode || !secret) {
      throw new ServiceUnavailableException({
        error: "customer_chat_login_unavailable",
        message: "Customer chat login is not configured."
      });
    }

    if (
      !CustomerChatSessionService.matchesAccessCode(
        request.accessCode,
        accessCode
      )
    ) {
      this.logger.warn(
        `Customer chat login rejected clientHash=${this.clientHash(clientKey)}`
      );
      throw new UnauthorizedException({
        error: "customer_chat_login_failed",
        message: "Invalid access code."
      });
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const expiresAtSeconds = nowSeconds + ttlSeconds;
    const subject = `customer-chat:${randomUUID()}`;
    const payload: jwt.JwtPayload = {
      sub: subject,
      scope: "chat:write",
      tenant: "tenant-demo",
      roles: ["customer"],
      channel: "react-chat-window",
      iat: nowSeconds,
      exp: expiresAtSeconds,
      ...(request.locale ? { locale: request.locale } : {})
    };

    const accessToken = jwt.sign(payload, secret, {
      algorithm: "HS256",
      ...(issuer ? { issuer } : {}),
      ...(audience ? { audience } : {})
    });

    return {
      accessToken,
      tokenType: "Bearer",
      expiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
      expiresInSeconds: ttlSeconds,
      subject
    };
  }

  private static matchesAccessCode(input: string, expected: string): boolean {
    return timingSafeEqual(
      CustomerChatSessionService.sha256(input.trim()),
      CustomerChatSessionService.sha256(expected)
    );
  }

  private static sha256(value: string): Buffer {
    return createHash("sha256").update(value, "utf8").digest();
  }

  private clientHash(clientKey: string): string {
    return createHash("sha256").update(clientKey).digest("hex").slice(0, 12);
  }
}
