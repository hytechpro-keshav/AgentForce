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
  rotationDueAt?: Date;
  subject: string;
  tenantId: string;
  salesforceOrgId: string;
  salesforceInstanceUrl?: string;
  ragNamespace: string;
  scopes: string[];
  roles: string[];
  status: OAuthClientStatus;
  tenantStatus: OAuthClientStatus;
  modelRoutingProfile?: string;
  rateLimitProfile?: string;
  alertPolicy?: string;
  dailyTokenQuota?: number;
  monthlyTokenQuota?: number;
  monthlyCostLimitCents?: number;
}

export interface OAuthAuditEvent {
  eventType:
    | "token_issued"
    | "token_rejected"
    | "client_upserted"
    | "client_status_changed"
    | "client_rotated"
    | "client_revoked"
    | "tenant_status_changed"
    | "quota_exceeded";
  clientId?: string;
  tenantId?: string;
  outcome: "success" | "error";
  reason?: string;
  clientHash?: string;
  sourceHash?: string;
}

export interface OAuthQuotaDecision {
  allowed: boolean;
  reason?: "daily_token_quota_exceeded" | "monthly_token_quota_exceeded";
  dailyIssued: number;
  monthlyIssued: number;
  dailyTokenQuota?: number;
  monthlyTokenQuota?: number;
}

export interface TenantClientReport {
  clientId: string;
  status: OAuthClientStatus;
  scopes: string[];
  roles: string[];
  lastUsedAt?: string;
  pendingSecretExpiresAt?: string;
  rotationDueAt?: string;
}

export interface TenantAuditSummary {
  tokenIssued24h: number;
  tokenRejected24h: number;
  tokenIssuedTotal: number;
  tokenRejectedTotal: number;
  quotaExceeded24h: number;
}

export interface TenantOperationsReport {
  tenantId: string;
  salesforceOrgId: string;
  salesforceInstanceUrl?: string;
  status: OAuthClientStatus;
  ragNamespace: string;
  scopes: string[];
  roles: string[];
  modelRoutingProfile?: string;
  rateLimitProfile?: string;
  alertPolicy?: string;
  quotas: {
    dailyTokenQuota?: number;
    monthlyTokenQuota?: number;
    monthlyCostLimitCents?: number;
  };
  clients: TenantClientReport[];
  audit: TenantAuditSummary;
  readiness: string[];
  alerts: string[];
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
  model_routing_profile: string | null;
  rate_limit_profile: string | null;
  alert_policy: string | null;
  daily_token_quota: number | null;
  monthly_token_quota: number | null;
  monthly_cost_limit_cents: number | null;
  rotation_due_at: Date | null;
}

interface TenantReportRow extends QueryResultRow {
  tenant_id: string;
  salesforce_org_id: string;
  salesforce_instance_url: string | null;
  tenant_status: OAuthClientStatus;
  rag_namespace: string;
  tenant_scopes: string[];
  tenant_roles: string[];
  model_routing_profile: string | null;
  rate_limit_profile: string | null;
  alert_policy: string | null;
  daily_token_quota: number | null;
  monthly_token_quota: number | null;
  monthly_cost_limit_cents: number | null;
  client_id: string | null;
  client_status: OAuthClientStatus | null;
  client_scopes: string[] | null;
  client_roles: string[] | null;
  last_used_at: Date | null;
  pending_secret_expires_at: Date | null;
  rotation_due_at: Date | null;
}

interface AuditCountRow extends QueryResultRow {
  tenant_id: string | null;
  client_id: string | null;
  event_type: string;
  total_count: string;
  count_24h: string;
}

interface QuotaCountRow extends QueryResultRow {
  daily_issued: string;
  monthly_issued: string;
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
          c.rotation_due_at,
          c.subject,
          c.tenant_id,
          c.allowed_scopes AS client_scopes,
          c.roles AS client_roles,
          c.status AS client_status,
          t.salesforce_org_id,
          t.salesforce_instance_url,
          t.rag_namespace,
          t.model_routing_profile,
          t.rate_limit_profile,
          t.alert_policy,
          t.daily_token_quota,
          t.monthly_token_quota,
          t.monthly_cost_limit_cents,
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
      rotationDueAt: row.rotation_due_at ?? undefined,
      subject: row.subject,
      tenantId: row.tenant_id,
      salesforceOrgId: row.salesforce_org_id,
      salesforceInstanceUrl: row.salesforce_instance_url ?? undefined,
      ragNamespace: row.rag_namespace,
      scopes,
      roles: row.client_roles.length ? row.client_roles : row.tenant_roles,
      status: row.client_status,
      tenantStatus: row.tenant_status,
      modelRoutingProfile: row.model_routing_profile ?? undefined,
      rateLimitProfile: row.rate_limit_profile ?? undefined,
      alertPolicy: row.alert_policy ?? undefined,
      dailyTokenQuota: row.daily_token_quota ?? undefined,
      monthlyTokenQuota: row.monthly_token_quota ?? undefined,
      monthlyCostLimitCents: row.monthly_cost_limit_cents ?? undefined
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

  async checkOAuthTokenQuota(
    client: OAuthClientGrant
  ): Promise<OAuthQuotaDecision> {
    if (this.config.oauth.tenantRegistry.provider !== "postgres") {
      return { allowed: true, dailyIssued: 0, monthlyIssued: 0 };
    }

    if (!client.dailyTokenQuota && !client.monthlyTokenQuota) {
      return { allowed: true, dailyIssued: 0, monthlyIssued: 0 };
    }

    const result = await this.requirePool().query<QuotaCountRow>(
      `
        SELECT
          count(*) FILTER (WHERE created_at >= date_trunc('day', now())) AS daily_issued,
          count(*) FILTER (WHERE created_at >= date_trunc('month', now())) AS monthly_issued
        FROM ai_api_oauth_audit_events
        WHERE event_type = 'token_issued'
          AND outcome = 'success'
          AND tenant_id = $1
      `,
      [client.tenantId]
    );
    const row = result.rows[0];
    const dailyIssued = Number(row?.daily_issued ?? 0);
    const monthlyIssued = Number(row?.monthly_issued ?? 0);

    if (
      client.dailyTokenQuota !== undefined &&
      dailyIssued >= client.dailyTokenQuota
    ) {
      return {
        allowed: false,
        reason: "daily_token_quota_exceeded",
        dailyIssued,
        monthlyIssued,
        dailyTokenQuota: client.dailyTokenQuota,
        monthlyTokenQuota: client.monthlyTokenQuota
      };
    }
    if (
      client.monthlyTokenQuota !== undefined &&
      monthlyIssued >= client.monthlyTokenQuota
    ) {
      return {
        allowed: false,
        reason: "monthly_token_quota_exceeded",
        dailyIssued,
        monthlyIssued,
        dailyTokenQuota: client.dailyTokenQuota,
        monthlyTokenQuota: client.monthlyTokenQuota
      };
    }

    return {
      allowed: true,
      dailyIssued,
      monthlyIssued,
      dailyTokenQuota: client.dailyTokenQuota,
      monthlyTokenQuota: client.monthlyTokenQuota
    };
  }

  async getTenantOperationsReport(
    tenantId: string
  ): Promise<TenantOperationsReport | undefined> {
    const reports = await this.loadTenantOperationsReports(tenantId);
    return reports[0];
  }

  async listTenantOperationsReports(): Promise<TenantOperationsReport[]> {
    return this.loadTenantOperationsReports();
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

  private async loadTenantOperationsReports(
    tenantId?: string
  ): Promise<TenantOperationsReport[]> {
    if (this.config.oauth.tenantRegistry.provider !== "postgres") {
      return this.loadConfigTenantReports(tenantId);
    }

    const rows = await this.loadPostgresTenantReportRows(tenantId);
    if (!rows.length) return [];
    const reportsByTenant = new Map<string, TenantOperationsReport>();
    const clientIdsByTenant = new Map<string, string[]>();

    for (const row of rows) {
      let report = reportsByTenant.get(row.tenant_id);
      if (!report) {
        report = {
          tenantId: row.tenant_id,
          salesforceOrgId: row.salesforce_org_id,
          salesforceInstanceUrl: row.salesforce_instance_url ?? undefined,
          status: row.tenant_status,
          ragNamespace: row.rag_namespace,
          scopes: row.tenant_scopes,
          roles: row.tenant_roles,
          modelRoutingProfile: row.model_routing_profile ?? undefined,
          rateLimitProfile: row.rate_limit_profile ?? undefined,
          alertPolicy: row.alert_policy ?? undefined,
          quotas: {
            dailyTokenQuota: row.daily_token_quota ?? undefined,
            monthlyTokenQuota: row.monthly_token_quota ?? undefined,
            monthlyCostLimitCents: row.monthly_cost_limit_cents ?? undefined
          },
          clients: [],
          audit: {
            tokenIssued24h: 0,
            tokenRejected24h: 0,
            tokenIssuedTotal: 0,
            tokenRejectedTotal: 0,
            quotaExceeded24h: 0
          },
          readiness: [],
          alerts: []
        };
        reportsByTenant.set(row.tenant_id, report);
        clientIdsByTenant.set(row.tenant_id, []);
      }

      if (row.client_id) {
        report.clients.push({
          clientId: row.client_id,
          status: row.client_status ?? "revoked",
          scopes: row.client_scopes ?? [],
          roles: row.client_roles ?? [],
          lastUsedAt: row.last_used_at?.toISOString(),
          pendingSecretExpiresAt: row.pending_secret_expires_at?.toISOString(),
          rotationDueAt: row.rotation_due_at?.toISOString()
        });
        clientIdsByTenant.get(row.tenant_id)?.push(row.client_id);
      }
    }

    await this.attachAuditSummaries(reportsByTenant, clientIdsByTenant);
    for (const report of reportsByTenant.values()) {
      report.readiness = TenantRegistryService.buildReadiness(report);
      report.alerts = TenantRegistryService.buildAlerts(report);
    }
    return Array.from(reportsByTenant.values());
  }

  private async loadPostgresTenantReportRows(
    tenantId?: string
  ): Promise<TenantReportRow[]> {
    const result = await this.requirePool().query<TenantReportRow>(
      `
        SELECT
          t.tenant_id,
          t.salesforce_org_id,
          t.salesforce_instance_url,
          t.status AS tenant_status,
          t.rag_namespace,
          t.allowed_scopes AS tenant_scopes,
          t.roles AS tenant_roles,
          t.model_routing_profile,
          t.rate_limit_profile,
          t.alert_policy,
          t.daily_token_quota,
          t.monthly_token_quota,
          t.monthly_cost_limit_cents,
          c.client_id,
          c.status AS client_status,
          c.allowed_scopes AS client_scopes,
          c.roles AS client_roles,
          c.last_used_at,
          c.pending_secret_expires_at,
          c.rotation_due_at
        FROM ai_api_tenants t
        LEFT JOIN ai_api_oauth_clients c ON c.tenant_id = t.tenant_id
        WHERE ($1::text IS NULL OR t.tenant_id = $1)
        ORDER BY t.tenant_id, c.client_id
      `,
      [tenantId ?? null]
    );
    return result.rows;
  }

  private async attachAuditSummaries(
    reportsByTenant: Map<string, TenantOperationsReport>,
    clientIdsByTenant: Map<string, string[]>
  ): Promise<void> {
    const tenantIds = Array.from(reportsByTenant.keys());
    const clientIds = Array.from(clientIdsByTenant.values()).flat();
    if (!tenantIds.length && !clientIds.length) return;

    const result = await this.requirePool().query<AuditCountRow>(
      `
        SELECT
          tenant_id,
          client_id,
          event_type,
          count(*) AS total_count,
          count(*) FILTER (WHERE created_at >= now() - interval '24 hours') AS count_24h
        FROM ai_api_oauth_audit_events
        WHERE tenant_id = ANY($1::text[]) OR client_id = ANY($2::text[])
        GROUP BY tenant_id, client_id, event_type
      `,
      [tenantIds, clientIds]
    );

    for (const row of result.rows) {
      const report = row.tenant_id
        ? reportsByTenant.get(row.tenant_id)
        : TenantRegistryService.findReportForClient(
            reportsByTenant,
            row.client_id
          );
      if (!report) continue;
      const total = Number(row.total_count ?? 0);
      const count24h = Number(row.count_24h ?? 0);
      if (row.event_type === "token_issued") {
        report.audit.tokenIssuedTotal += total;
        report.audit.tokenIssued24h += count24h;
      } else if (row.event_type === "token_rejected") {
        report.audit.tokenRejectedTotal += total;
        report.audit.tokenRejected24h += count24h;
      } else if (row.event_type === "quota_exceeded") {
        report.audit.quotaExceeded24h += count24h;
      }
    }
  }

  private loadConfigTenantReports(tenantId?: string): TenantOperationsReport[] {
    const reports = new Map<string, TenantOperationsReport>();
    for (const client of this.config.oauth.clients) {
      if (tenantId && client.tenantId !== tenantId) continue;
      let report = reports.get(client.tenantId);
      if (!report) {
        report = {
          tenantId: client.tenantId,
          salesforceOrgId: client.salesforceOrgId,
          salesforceInstanceUrl: client.salesforceInstanceUrl,
          status: "active",
          ragNamespace: client.ragNamespace,
          scopes: client.scopes,
          roles: client.roles,
          quotas: {},
          clients: [],
          audit: {
            tokenIssued24h: 0,
            tokenRejected24h: 0,
            tokenIssuedTotal: 0,
            tokenRejectedTotal: 0,
            quotaExceeded24h: 0
          },
          readiness: [],
          alerts: ["config_registry_has_no_durable_audit"]
        };
        reports.set(client.tenantId, report);
      }
      report.clients.push({
        clientId: client.clientId,
        status: client.status,
        scopes: client.scopes,
        roles: client.roles,
        pendingSecretExpiresAt: client.pendingSecretExpiresAt
      });
    }
    for (const report of reports.values()) {
      report.readiness = TenantRegistryService.buildReadiness(report);
      report.alerts = Array.from(
        new Set([
          ...report.alerts,
          ...TenantRegistryService.buildAlerts(report)
        ])
      );
    }
    return Array.from(reports.values());
  }

  private static findReportForClient(
    reportsByTenant: Map<string, TenantOperationsReport>,
    clientId: string | null
  ): TenantOperationsReport | undefined {
    if (!clientId) return undefined;
    for (const report of reportsByTenant.values()) {
      if (report.clients.some((client) => client.clientId === clientId)) {
        return report;
      }
    }
    return undefined;
  }

  private static buildReadiness(report: TenantOperationsReport): string[] {
    const readiness: string[] = [];
    if (report.status === "active") readiness.push("tenant_active");
    if (report.ragNamespace) readiness.push("rag_namespace_configured");
    if (report.scopes.includes("agentforce:services-project-health")) {
      readiness.push("project_health_scope_granted");
    }
    if (report.clients.some((client) => client.status === "active")) {
      readiness.push("active_oauth_client_present");
    }
    if (report.modelRoutingProfile) readiness.push("model_policy_configured");
    if (report.rateLimitProfile || report.quotas.dailyTokenQuota) {
      readiness.push("rate_or_quota_policy_configured");
    }
    return readiness;
  }

  private static buildAlerts(report: TenantOperationsReport): string[] {
    const alerts = new Set<string>();
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

    if (report.status !== "active") alerts.add("tenant_not_active");
    if (!report.clients.length) alerts.add("no_oauth_clients");
    if (!report.quotas.dailyTokenQuota && !report.quotas.monthlyTokenQuota) {
      alerts.add("token_quota_not_configured");
    }
    for (const client of report.clients) {
      if (client.status !== "active") alerts.add("oauth_client_not_active");
      if (!client.lastUsedAt) {
        alerts.add("oauth_client_never_used");
      } else if (Date.parse(client.lastUsedAt) < now - thirtyDaysMs) {
        alerts.add("oauth_client_stale_30d");
      }
      if (
        client.pendingSecretExpiresAt &&
        Date.parse(client.pendingSecretExpiresAt) <= now + sevenDaysMs
      ) {
        alerts.add("pending_secret_expires_within_7d");
      }
      if (client.rotationDueAt && Date.parse(client.rotationDueAt) <= now) {
        alerts.add("client_rotation_overdue");
      }
    }
    if (
      report.quotas.dailyTokenQuota &&
      report.audit.tokenIssued24h >= report.quotas.dailyTokenQuota * 0.8
    ) {
      alerts.add("daily_token_quota_near_limit");
    }
    if (report.audit.quotaExceeded24h > 0) {
      alerts.add("quota_exceeded_last_24h");
    }
    return Array.from(alerts);
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
        alert_policy text,
        daily_token_quota integer CHECK (daily_token_quota IS NULL OR daily_token_quota >= 0),
        monthly_token_quota integer CHECK (monthly_token_quota IS NULL OR monthly_token_quota >= 0),
        monthly_cost_limit_cents integer CHECK (monthly_cost_limit_cents IS NULL OR monthly_cost_limit_cents >= 0),
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
        rotation_due_at timestamptz,
        allowed_scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
        roles text[] NOT NULL DEFAULT ARRAY[]::text[],
        status text NOT NULL CHECK (status IN ('active', 'suspended', 'revoked')),
        last_used_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_api_tenant_usage_daily (
        tenant_id text NOT NULL REFERENCES ai_api_tenants(tenant_id) ON DELETE CASCADE,
        usage_date date NOT NULL,
        route text NOT NULL,
        request_count integer NOT NULL DEFAULT 0,
        error_count integer NOT NULL DEFAULT 0,
        input_tokens integer NOT NULL DEFAULT 0,
        output_tokens integer NOT NULL DEFAULT 0,
        total_tokens integer NOT NULL DEFAULT 0,
        cost_cents_estimate integer NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, usage_date, route)
      )
    `);

    await client.query(
      "ALTER TABLE ai_api_tenants ADD COLUMN IF NOT EXISTS alert_policy text"
    );
    await client.query(
      "ALTER TABLE ai_api_tenants ADD COLUMN IF NOT EXISTS daily_token_quota integer CHECK (daily_token_quota IS NULL OR daily_token_quota >= 0)"
    );
    await client.query(
      "ALTER TABLE ai_api_tenants ADD COLUMN IF NOT EXISTS monthly_token_quota integer CHECK (monthly_token_quota IS NULL OR monthly_token_quota >= 0)"
    );
    await client.query(
      "ALTER TABLE ai_api_tenants ADD COLUMN IF NOT EXISTS monthly_cost_limit_cents integer CHECK (monthly_cost_limit_cents IS NULL OR monthly_cost_limit_cents >= 0)"
    );
    await client.query(
      "ALTER TABLE ai_api_oauth_clients ADD COLUMN IF NOT EXISTS rotation_due_at timestamptz"
    );

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
      "CREATE INDEX IF NOT EXISTS ai_api_oauth_audit_events_client_idx ON ai_api_oauth_audit_events(client_id)"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS ai_api_oauth_audit_events_tenant_idx ON ai_api_oauth_audit_events(tenant_id)"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS ai_api_oauth_audit_events_created_idx ON ai_api_oauth_audit_events(created_at)"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS ai_api_tenant_usage_daily_route_idx ON ai_api_tenant_usage_daily(route)"
    );
  }
}
