import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit
} from "@nestjs/common";
import { Pool, type PoolClient, type QueryResultRow } from "pg";

import type { OAuthClientStatus } from "../config/app-config.service";
import { AppConfigService } from "../config/app-config.service";

export interface OAuthClientGrant {
  clientId: string;
  clientSecretSha256: string;
  pendingClientSecretSha256?: string;
  pendingSecretExpiresAt?: Date;
  subject: string;
  tenantId: string;
  salesforceOrgId: string;
  salesforceInstanceUrl?: string;
  ragNamespace: string;
  scopes: string[];
  roles: string[];
  status: OAuthClientStatus;
  tenantStatus: OAuthClientStatus;
}

export interface OAuthAuditEvent {
  eventType: "token_issued" | "token_rejected";
  clientId?: string;
  tenantId?: string;
  outcome: "success" | "error";
  reason?: string;
  clientHash?: string;
  sourceHash?: string;
}

interface OAuthClientRow extends QueryResultRow {
  client_id: string;
  client_secret_sha256: string;
  pending_client_secret_sha256: string | null;
  pending_secret_expires_at: Date | null;
  subject: string;
  tenant_id: string;
  salesforce_org_id: string;
  salesforce_instance_url: string | null;
  rag_namespace: string;
  client_scopes: string[];
  client_roles: string[];
  client_status: OAuthClientStatus;
  tenant_status: OAuthClientStatus;
  tenant_scopes: string[];
  tenant_roles: string[];
}

@Injectable()
export class TenantRegistryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TenantRegistryService.name);
  private pool?: Pool;

  constructor(private readonly config: AppConfigService) {}

  async onModuleInit(): Promise<void> {
    if (this.config.oauth.tenantRegistry.provider !== "postgres") {
      return;
    }

    const { databaseUrl, ssl, maxPoolSize, autoMigrate } =
      this.config.oauth.tenantRegistry;
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: maxPoolSize,
      ...(ssl ? { ssl: { rejectUnauthorized: false } } : {})
    });

    if (autoMigrate) {
      await this.migrate();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }

  async findOAuthClient(
    clientId: string
  ): Promise<OAuthClientGrant | undefined> {
    if (this.config.oauth.tenantRegistry.provider !== "postgres") {
      return this.findConfigOAuthClient(clientId);
    }

    const pool = this.requirePool();
    const result = await pool.query<OAuthClientRow>(
      `
        SELECT
          c.client_id,
          c.client_secret_sha256,
          c.pending_client_secret_sha256,
          c.pending_secret_expires_at,
          c.subject,
          c.tenant_id,
          c.allowed_scopes AS client_scopes,
          c.roles AS client_roles,
          c.status AS client_status,
          t.salesforce_org_id,
          t.salesforce_instance_url,
          t.rag_namespace,
          t.allowed_scopes AS tenant_scopes,
          t.roles AS tenant_roles,
          t.status AS tenant_status
        FROM ai_api_oauth_clients c
        INNER JOIN ai_api_tenants t ON t.tenant_id = c.tenant_id
        WHERE c.client_id = $1
        LIMIT 1
      `,
      [clientId]
    );

    const row = result.rows[0];
    if (!row) return undefined;
    const tenantScopes = new Set(row.tenant_scopes);
    const scopes = row.client_scopes.filter((scope) => tenantScopes.has(scope));

    return {
      clientId: row.client_id,
      clientSecretSha256: row.client_secret_sha256,
      pendingClientSecretSha256: row.pending_client_secret_sha256 ?? undefined,
      pendingSecretExpiresAt: row.pending_secret_expires_at ?? undefined,
      subject: row.subject,
      tenantId: row.tenant_id,
      salesforceOrgId: row.salesforce_org_id,
      salesforceInstanceUrl: row.salesforce_instance_url ?? undefined,
      ragNamespace: row.rag_namespace,
      scopes,
      roles: row.client_roles.length ? row.client_roles : row.tenant_roles,
      status: row.client_status,
      tenantStatus: row.tenant_status
    };
  }

  async recordOAuthClientUsed(clientId: string): Promise<void> {
    if (this.config.oauth.tenantRegistry.provider !== "postgres") {
      return;
    }

    try {
      await this.requirePool().query(
        `
          UPDATE ai_api_oauth_clients
          SET last_used_at = now(), updated_at = now()
          WHERE client_id = $1
        `,
        [clientId]
      );
    } catch (err) {
      this.logger.warn(
        `OAuth client last-used update failed: ${(err as Error).name}`
      );
    }
  }

  async recordAuditEvent(event: OAuthAuditEvent): Promise<void> {
    if (this.config.oauth.tenantRegistry.provider !== "postgres") {
      return;
    }

    try {
      await this.requirePool().query(
        `
          INSERT INTO ai_api_oauth_audit_events (
            event_type,
            client_id,
            tenant_id,
            outcome,
            reason,
            client_hash,
            source_hash
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          event.eventType,
          event.clientId,
          event.tenantId,
          event.outcome,
          event.reason,
          event.clientHash,
          event.sourceHash
        ]
      );
    } catch (err) {
      this.logger.warn(`OAuth audit write failed: ${(err as Error).name}`);
    }
  }

  private findConfigOAuthClient(
    clientId: string
  ): OAuthClientGrant | undefined {
    const client = this.config.oauth.clients.find(
      (candidate) => candidate.clientId === clientId
    );
    if (!client) return undefined;

    return {
      clientId: client.clientId,
      clientSecretSha256: client.clientSecretSha256,
      pendingClientSecretSha256: client.pendingClientSecretSha256,
      pendingSecretExpiresAt: client.pendingSecretExpiresAt
        ? new Date(client.pendingSecretExpiresAt)
        : undefined,
      subject: client.subject,
      tenantId: client.tenantId,
      salesforceOrgId: client.salesforceOrgId,
      salesforceInstanceUrl: client.salesforceInstanceUrl,
      ragNamespace: client.ragNamespace,
      scopes: client.scopes,
      roles: client.roles,
      status: client.status,
      tenantStatus: "active"
    };
  }

  private requirePool(): Pool {
    if (!this.pool) {
      throw new Error("Tenant registry Postgres pool is not initialized.");
    }
    return this.pool;
  }

  private async migrate(): Promise<void> {
    const pool = this.requirePool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await TenantRegistryService.createSchema(client);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  private static async createSchema(client: PoolClient): Promise<void> {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_api_tenants (
        tenant_id text PRIMARY KEY,
        salesforce_org_id text NOT NULL,
        salesforce_instance_url text,
        status text NOT NULL CHECK (status IN ('active', 'suspended', 'revoked')),
        rag_namespace text NOT NULL,
        allowed_scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
        roles text[] NOT NULL DEFAULT ARRAY[]::text[],
        model_routing_profile text,
        rate_limit_profile text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_api_oauth_clients (
        client_id text PRIMARY KEY,
        tenant_id text NOT NULL REFERENCES ai_api_tenants(tenant_id) ON DELETE CASCADE,
        subject text NOT NULL,
        client_secret_sha256 text NOT NULL CHECK (client_secret_sha256 ~* '^[a-f0-9]{64}$'),
        pending_client_secret_sha256 text CHECK (pending_client_secret_sha256 IS NULL OR pending_client_secret_sha256 ~* '^[a-f0-9]{64}$'),
        pending_secret_expires_at timestamptz,
        allowed_scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
        roles text[] NOT NULL DEFAULT ARRAY[]::text[],
        status text NOT NULL CHECK (status IN ('active', 'suspended', 'revoked')),
        last_used_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_api_oauth_audit_events (
        id bigserial PRIMARY KEY,
        event_type text NOT NULL,
        client_id text,
        tenant_id text,
        outcome text NOT NULL,
        reason text,
        client_hash text,
        source_hash text,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await client.query(
      "CREATE INDEX IF NOT EXISTS ai_api_oauth_clients_tenant_idx ON ai_api_oauth_clients(tenant_id)"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS ai_api_oauth_audit_events_created_idx ON ai_api_oauth_audit_events(created_at)"
    );
  }
}
