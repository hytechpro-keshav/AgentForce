import { Injectable, Logger } from "@nestjs/common";

import { AppConfigService } from "../config/app-config.service";
import { SalesforceGatewayError } from "./salesforce-gateway.error";
import { fetchWithTimeout, readJsonObject } from "./salesforce-http.util";

export interface SalesforceAccessContext {
  accessToken: string;
  instanceUrl: string;
}

/**
 * Obtains and caches a Salesforce access token using the OAuth 2.0
 * client-credentials flow against a connected app.
 *
 * This is the only place that holds the Salesforce client secret. It
 * never logs the secret, the token, or the response body. Tokens are
 * cached in-process and invalidated on a 401 from a data call.
 */
@Injectable()
export class SalesforceAuthService {
  private readonly logger = new Logger(SalesforceAuthService.name);
  private cached?: {
    accessToken: string;
    instanceUrl: string;
    expiresAt: number;
  };

  constructor(private readonly config: AppConfigService) {}

  isConfigured(): boolean {
    return this.config.salesforceConnection.enabled;
  }

  invalidate(): void {
    this.cached = undefined;
  }

  async getAccessContext(): Promise<SalesforceAccessContext> {
    const conn = this.config.salesforceConnection;
    if (
      !conn.enabled ||
      !conn.tokenUrl ||
      !conn.clientId ||
      !conn.clientSecret
    ) {
      throw new SalesforceGatewayError(
        "not_configured",
        "Salesforce outbound connection is not configured."
      );
    }

    const now = Date.now();
    if (this.cached && this.cached.expiresAt > now + 5000) {
      return {
        accessToken: this.cached.accessToken,
        instanceUrl: this.cached.instanceUrl
      };
    }

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: conn.clientId,
      client_secret: conn.clientSecret
    });

    const response = await fetchWithTimeout(
      conn.tokenUrl,
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json"
        },
        body: body.toString()
      },
      conn.timeoutMs
    );

    if (response.status === 400 || response.status === 401) {
      this.logger.warn(
        `Salesforce token request rejected (status=${response.status}).`
      );
      throw new SalesforceGatewayError(
        "auth",
        "Salesforce rejected the connected-app credentials."
      );
    }
    if (!response.ok) {
      this.logger.warn(
        `Salesforce token endpoint error (status=${response.status}).`
      );
      throw new SalesforceGatewayError(
        "backend",
        "Salesforce token endpoint returned an error."
      );
    }

    const json = await readJsonObject(response);
    const accessToken =
      typeof json["access_token"] === "string"
        ? (json["access_token"] as string)
        : undefined;
    const instanceUrl =
      typeof json["instance_url"] === "string"
        ? (json["instance_url"] as string).replace(/\/$/, "")
        : conn.instanceUrl;

    if (!accessToken || !instanceUrl) {
      throw new SalesforceGatewayError(
        "malformed",
        "Salesforce token response was missing access_token or instance_url."
      );
    }

    // The client-credentials flow does not return expires_in; cache
    // conservatively and rely on 401-triggered invalidation.
    this.cached = {
      accessToken,
      instanceUrl,
      expiresAt: now + 25 * 60 * 1000
    };
    return { accessToken, instanceUrl };
  }
}
