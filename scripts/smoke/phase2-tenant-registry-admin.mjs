#!/usr/bin/env node
import { createHash, createHmac, randomBytes } from "crypto";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { Pool } from "pg";

const DEFAULT_SCOPES =
  "agentforce:support-triage agentforce:case-analysis agentforce:knowledge-rag agentforce:services-project-health";
const DEFAULT_ROLES = "salesforce-agentforce";
const SAFE_IDENTIFIER = /^[A-Za-z0-9:_-]{1,128}$/;
const SAFE_HASH = /^[a-f0-9]{64}$/i;
const VALID_STATUS = new Set(["active", "suspended", "revoked"]);

const args = parseArgs(process.argv.slice(2));
const command = args._[0];

if (!command || args.help === "true") {
  printHelp();
  process.exit(command ? 0 : 1);
}

const databaseUrl =
  args["database-url"] ??
  readOptionalSecretTextFile(args["database-url-file"], "database-url-file") ??
  process.env.AI_API_TENANT_REGISTRY_DATABASE_URL ??
  process.env.DATABASE_URL;

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  ssl: readBoolean(args.ssl ?? process.env.AI_API_TENANT_REGISTRY_DATABASE_SSL)
    ? { rejectUnauthorized: false }
    : undefined
});

try {
  if (!databaseUrl) {
    fail("DATABASE_URL or AI_API_TENANT_REGISTRY_DATABASE_URL is required.");
  }

  if (command === "upsert-oauth-client") {
    await upsertOAuthClient();
  } else if (command === "set-tenant-status") {
    await setTenantStatus();
  } else if (command === "set-client-status") {
    await setClientStatus();
  } else if (command === "show-tenant") {
    await showTenant();
  } else {
    fail(`Unknown command: ${command}`);
  }
} finally {
  await pool.end();
}

async function upsertOAuthClient() {
  const tenantId = readIdentifier("tenant-id");
  const salesforceOrgId = readIdentifier("salesforce-org-id");
  const clientId = readIdentifier("client-id");
  const tenantStatus = readStatus(
    args["tenant-status"] ?? "active",
    "tenant-status"
  );
  const clientStatus = readStatus(
    args["client-status"] ?? "active",
    "client-status"
  );
  const ragNamespace = readIdentifierValue(
    args["rag-namespace"] ?? tenantId,
    "rag-namespace"
  );
  const subject = readIdentifierValue(
    args.subject ?? `salesforce-org:${salesforceOrgId}`,
    "subject"
  );
  const tenantScopes = readList(
    args["tenant-scopes"] ?? args.scopes ?? DEFAULT_SCOPES
  );
  const clientScopes = readList(
    args["client-scopes"] ?? args.scopes ?? DEFAULT_SCOPES
  );
  const tenantRoles = readList(
    args["tenant-roles"] ?? args.roles ?? DEFAULT_ROLES
  );
  const clientRoles = readList(
    args["client-roles"] ?? args.roles ?? DEFAULT_ROLES
  );
  const salesforceInstanceUrl = readOptionalUrl(
    args["salesforce-instance-url"]
  );
  const clientSecretSha256 = readSecretHash("client");
  const pendingClientSecretSha256 = readOptionalSecretHash("pending-client");
  const pendingSecretExpiresAt = readOptionalIsoDatetime(
    args["pending-secret-expires-at"],
    "pending-secret-expires-at"
  );
  const rotationDueAt = readOptionalIsoDatetime(
    args["rotation-due-at"],
    "rotation-due-at"
  );
  const dailyTokenQuota = readOptionalInteger(
    args["daily-token-quota"],
    "daily-token-quota"
  );
  const monthlyTokenQuota = readOptionalInteger(
    args["monthly-token-quota"],
    "monthly-token-quota"
  );
  const monthlyCostLimitCents = readOptionalInteger(
    args["monthly-cost-limit-cents"],
    "monthly-cost-limit-cents"
  );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `
        INSERT INTO ai_api_tenants (
          tenant_id,
          salesforce_org_id,
          salesforce_instance_url,
          status,
          rag_namespace,
          allowed_scopes,
          roles,
          model_routing_profile,
          rate_limit_profile,
          alert_policy,
          daily_token_quota,
          monthly_token_quota,
          monthly_cost_limit_cents
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (tenant_id) DO UPDATE SET
          salesforce_org_id = excluded.salesforce_org_id,
          salesforce_instance_url = excluded.salesforce_instance_url,
          status = excluded.status,
          rag_namespace = excluded.rag_namespace,
          allowed_scopes = excluded.allowed_scopes,
          roles = excluded.roles,
          model_routing_profile = excluded.model_routing_profile,
          rate_limit_profile = excluded.rate_limit_profile,
          alert_policy = excluded.alert_policy,
          daily_token_quota = excluded.daily_token_quota,
          monthly_token_quota = excluded.monthly_token_quota,
          monthly_cost_limit_cents = excluded.monthly_cost_limit_cents,
          updated_at = now()
      `,
      [
        tenantId,
        salesforceOrgId,
        salesforceInstanceUrl,
        tenantStatus,
        ragNamespace,
        tenantScopes,
        tenantRoles,
        args["model-routing-profile"] ?? null,
        args["rate-limit-profile"] ?? null,
        args["alert-policy"] ?? null,
        dailyTokenQuota,
        monthlyTokenQuota,
        monthlyCostLimitCents
      ]
    );
    await client.query(
      `
        INSERT INTO ai_api_oauth_clients (
          client_id,
          tenant_id,
          subject,
          client_secret_sha256,
          pending_client_secret_sha256,
          pending_secret_expires_at,
          rotation_due_at,
          allowed_scopes,
          roles,
          status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (client_id) DO UPDATE SET
          tenant_id = excluded.tenant_id,
          subject = excluded.subject,
          client_secret_sha256 = excluded.client_secret_sha256,
          pending_client_secret_sha256 = excluded.pending_client_secret_sha256,
          pending_secret_expires_at = excluded.pending_secret_expires_at,
          rotation_due_at = excluded.rotation_due_at,
          allowed_scopes = excluded.allowed_scopes,
          roles = excluded.roles,
          status = excluded.status,
          updated_at = now()
      `,
      [
        clientId,
        tenantId,
        subject,
        clientSecretSha256,
        pendingClientSecretSha256,
        pendingSecretExpiresAt,
        rotationDueAt,
        clientScopes,
        clientRoles,
        clientStatus
      ]
    );
    await client.query(
      `
        INSERT INTO ai_api_oauth_audit_events (
          event_type,
          client_id,
          tenant_id,
          outcome,
          reason,
          client_hash
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        "client_upserted",
        clientId,
        tenantId,
        "success",
        null,
        safeHash(clientId)
      ]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  process.stdout.write(
    JSON.stringify(
      {
        tenantId,
        clientId,
        tenantStatus,
        clientStatus,
        tenantScopes,
        clientScopes,
        alertPolicy: args["alert-policy"] ?? null,
        dailyTokenQuota,
        monthlyTokenQuota,
        monthlyCostLimitCents,
        rotationDueAt,
        secretMaterialPrinted: false
      },
      null,
      2
    ) + "\n"
  );
}

async function setTenantStatus() {
  const tenantId = readIdentifier("tenant-id");
  const status = readStatus(args.status, "status");
  const client = await pool.connect();
  let rowCount = 0;
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `
        UPDATE ai_api_tenants
        SET status = $2, updated_at = now()
        WHERE tenant_id = $1
      `,
      [tenantId, status]
    );
    rowCount = result.rowCount;
    if (rowCount > 0) {
      await client.query(
        `
          INSERT INTO ai_api_oauth_audit_events (
            event_type,
            client_id,
            tenant_id,
            outcome,
            reason,
            client_hash
          ) VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [
          "tenant_status_changed",
          null,
          tenantId,
          "success",
          `status:${status}`,
          safeHash(tenantId)
        ]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  process.stdout.write(
    JSON.stringify({ tenantId, status, updated: rowCount }, null, 2) + "\n"
  );
}

async function setClientStatus() {
  const clientId = readIdentifier("client-id");
  const status = readStatus(args.status, "status");
  const client = await pool.connect();
  let rowCount = 0;
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `
        UPDATE ai_api_oauth_clients
        SET status = $2, updated_at = now()
        WHERE client_id = $1
        RETURNING tenant_id
      `,
      [clientId, status]
    );
    rowCount = result.rowCount;
    if (rowCount > 0) {
      await client.query(
        `
          INSERT INTO ai_api_oauth_audit_events (
            event_type,
            client_id,
            tenant_id,
            outcome,
            reason,
            client_hash
          ) VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [
          status === "revoked" ? "client_revoked" : "client_status_changed",
          clientId,
          result.rows[0].tenant_id,
          "success",
          `status:${status}`,
          safeHash(clientId)
        ]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  process.stdout.write(
    JSON.stringify({ clientId, status, updated: rowCount }, null, 2) + "\n"
  );
}

async function showTenant() {
  const tenantId = readIdentifier("tenant-id");
  const result = await pool.query(
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
        c.rotation_due_at,
        c.last_used_at
      FROM ai_api_tenants t
      LEFT JOIN ai_api_oauth_clients c ON c.tenant_id = t.tenant_id
      WHERE t.tenant_id = $1
      ORDER BY c.client_id
    `,
    [tenantId]
  );
  process.stdout.write(JSON.stringify({ rows: result.rows }, null, 2) + "\n");
}

function readSecretHash(prefix) {
  const directHash = args[`${prefix}-secret-sha256`];
  if (directHash) return normalizeHash(directHash, `${prefix}-secret-sha256`);

  const secretFile = args[`${prefix}-secret-file`];
  if (secretFile) return hashSecret(readSecretFile(secretFile));

  if (args[`${prefix}-generate-secret`] === "true") {
    const secret = randomBytes(32).toString("base64url");
    const outputFile = args[`${prefix}-secret-output-file`];
    if (!outputFile) {
      fail(
        `--${prefix}-secret-output-file is required with --${prefix}-generate-secret.`
      );
    }
    writeSecretFile(outputFile, secret);
    return hashSecret(secret);
  }

  fail(
    `One of --${prefix}-secret-sha256, --${prefix}-secret-file, or --${prefix}-generate-secret is required.`
  );
}

function readOptionalSecretHash(prefix) {
  const directHash = args[`${prefix}-secret-sha256`];
  const secretFile = args[`${prefix}-secret-file`];
  const generateSecret = args[`${prefix}-generate-secret`] === "true";
  if (!directHash && !secretFile && !generateSecret) return null;
  return readSecretHash(prefix);
}

function hashSecret(secret) {
  const pepper = process.env.AI_API_OAUTH_CLIENT_SECRET_PEPPER;
  if (pepper) {
    return createHmac("sha256", pepper).update(secret).digest("hex");
  }
  return createHash("sha256").update(secret).digest("hex");
}

function normalizeHash(hash, name) {
  if (!SAFE_HASH.test(hash)) {
    fail(`--${name} must be a 64-character SHA-256 hex digest.`);
  }
  return hash.toLowerCase();
}

function readSecretFile(path) {
  const value = readFileSync(path, "utf8").replace(/\r?\n$/, "");
  if (!value) fail(`${path} did not contain a client secret.`);
  return value;
}

function readOptionalSecretTextFile(path, name) {
  if (!path) return null;
  const value = readFileSync(path, "utf8").replace(/\r?\n$/, "");
  if (!value) fail(`--${name} did not contain a value.`);
  return value;
}

function writeSecretFile(path, secret) {
  if (existsSync(path)) {
    fail(
      `${path} already exists; refusing to overwrite client secret material.`
    );
  }
  writeFileSync(path, `${secret}\n`, { mode: 0o600, flag: "wx" });
}

function readIdentifier(name) {
  const value = args[name];
  if (!value) fail(`--${name} is required.`);
  return readIdentifierValue(value, name);
}

function readIdentifierValue(value, name) {
  if (!SAFE_IDENTIFIER.test(value)) {
    fail(`--${name} must be 1 to 128 safe identifier characters.`);
  }
  return value;
}

function readStatus(value, name) {
  if (!VALID_STATUS.has(value)) {
    fail(`--${name} must be active, suspended, or revoked.`);
  }
  return value;
}

function readList(rawValue) {
  return Array.from(
    new Set(
      String(rawValue)
        .split(/[\s,]+/)
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
}

function readOptionalUrl(value) {
  if (!value) return null;
  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch {
    fail("--salesforce-instance-url must be a valid URL.");
  }
}

function readOptionalIsoDatetime(value, name) {
  if (!value) return null;
  if (Number.isNaN(Date.parse(value))) {
    fail(`--${name} must be an ISO datetime.`);
  }
  return value;
}

function readOptionalInteger(value, name) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    fail(`--${name} must be a non-negative integer.`);
  }
  return parsed;
}

function readBoolean(rawValue) {
  if (!rawValue) return false;
  if (rawValue === "true") return true;
  if (rawValue === "false") return false;
  fail("SSL flags must be true or false.");
}

function safeHash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function parseArgs(rawArgs) {
  const parsed = { _: [] };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--")) {
      parsed._.push(arg);
      continue;
    }
    const withoutPrefix = arg.slice(2);
    const [key, inlineValue] = withoutPrefix.split("=", 2);
    if (inlineValue !== undefined) {
      parsed[key] = inlineValue;
      continue;
    }
    const next = rawArgs[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[key] = next;
      index += 1;
    } else {
      parsed[key] = "true";
    }
  }
  return parsed;
}

function printHelp() {
  process.stdout.write(`Usage:
  node scripts/smoke/phase2-tenant-registry-admin.mjs upsert-oauth-client \\
    --tenant-id TENANT --salesforce-org-id ORG_ID --client-id CLIENT \\
    --client-generate-secret --client-secret-output-file /tmp/client.secret \
    --model-routing-profile services-default --rate-limit-profile standard \
    --alert-policy ops-default --daily-token-quota 100 --monthly-token-quota 3000 \
    --monthly-cost-limit-cents 25000 --rotation-due-at 2026-06-01T00:00:00Z

  node scripts/smoke/phase2-tenant-registry-admin.mjs set-tenant-status \\
    --tenant-id TENANT --status suspended

  node scripts/smoke/phase2-tenant-registry-admin.mjs set-client-status \\
    --client-id CLIENT --status revoked

  node scripts/smoke/phase2-tenant-registry-admin.mjs show-tenant \\
    --tenant-id TENANT

Secrets and database URLs may be read from files. Raw secrets are never printed.
`);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
