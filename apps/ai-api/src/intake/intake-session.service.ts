import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { randomUUID } from "crypto";
import * as jwt from "jsonwebtoken";

import { AppConfigService } from "../config/app-config.service";
import type { IntakeSessionResponseDto } from "./dto/intake-otp.dto";

export interface IntakeSessionClaims {
  accountId: string;
  contactId: string;
  verifiedEmail: string;
  locale?: string;
}

/**
 * Mints the verified-intake browser JWT after OTP verification. Unlike the
 * shared-access-code customer-chat token, this token carries the verified
 * `accountId`/`contactId` claims plus the `chat:intake` scope, so downstream
 * intake reads and the chat-driven Case create are scoped to the verified
 * customer without any server-side session store.
 */
@Injectable()
export class IntakeSessionService {
  constructor(private readonly config: AppConfigService) {}

  mint(claims: IntakeSessionClaims): IntakeSessionResponseDto {
    const { secret, issuer, audience } = this.config.jwt;
    if (!secret) {
      throw new ServiceUnavailableException({
        error: "customer_intake_unavailable",
        message: "Customer intake is not configured."
      });
    }

    const ttlSeconds = this.config.customerIntake.sessionTtlSeconds;
    const nowSeconds = Math.floor(Date.now() / 1000);
    const expiresAtSeconds = nowSeconds + ttlSeconds;
    const subject = `customer-chat:${randomUUID()}`;

    const payload: jwt.JwtPayload = {
      sub: subject,
      scope: "chat:intake chat:write",
      tenant: "tenant-demo",
      roles: ["customer"],
      channel: "react-chat-window",
      verified: true,
      accountId: claims.accountId,
      contactId: claims.contactId,
      verifiedEmail: claims.verifiedEmail,
      iat: nowSeconds,
      exp: expiresAtSeconds,
      ...(claims.locale ? { locale: claims.locale } : {})
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
}
