#!/usr/bin/env node
import { readFileSync, unlinkSync } from "fs";
import pg from "pg";

const { Pool } = pg;
const args = parseArgs(process.argv.slice(2));
const baseUrl = args["base-url"] ?? process.env.AI_API_BASE_URL;
const databaseUrl = args["database-url"] ?? process.env.DATABASE_URL;
const scope = args.scope ?? "agentforce:services-project-health";

const tenantA = {
  tenantId: args["tenant-a-id"] ?? "phase2-smoke-org-a",
  clientId: args["tenant-a-client-id"] ?? "phase2-smoke-org-a-client",
  secretFile:
    args["tenant-a-secret-file"] ?? "/tmp/agentforce-phase2-smoke-a.secret",
  requestId: "phase2-smoke-a"
};
const tenantB = {
  tenantId: args["tenant-b-id"] ?? "phase2-smoke-org-b",
  clientId: args["tenant-b-client-id"] ?? "phase2-smoke-org-b-client",
  secretFile:
    args["tenant-b-secret-file"] ?? "/tmp/agentforce-phase2-smoke-b.secret",
  requestId: "phase2-smoke-b"
};

if (!baseUrl) fail("AI_API_BASE_URL or --base-url is required.");
if (!databaseUrl) fail("DATABASE_URL or --database-url is required.");

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  ssl: readBoolean(args.ssl ?? process.env.AI_API_TENANT_REGISTRY_DATABASE_SSL)
    ? { rejectUnauthorized: false }
    : undefined
});

try {
  const secretA = readSecret(tenantA.secretFile);
  const secretB = readSecret(tenantB.secretFile);

  const tokenA = await tokenRequest(tenantA.clientId, secretA, scope);
  logStatus("tenantA.token", tokenA.status, 201);
  logClaims("tenantA", tokenA.body.access_token);

  const healthA = await projectHealth(
    tokenA.body.access_token,
    tenantA.requestId
  );
  logStatus("tenantA.projectHealth", healthA.status, 201);
  logHealth("tenantA", healthA.body);

  const tokenB = await tokenRequest(tenantB.clientId, secretB, scope);
  logStatus("tenantB.token", tokenB.status, 201);
  logClaims("tenantB", tokenB.body.access_token);

  const healthB = await projectHealth(
    tokenB.body.access_token,
    tenantB.requestId
  );
  logStatus("tenantB.projectHealth", healthB.status, 201);
  logHealth("tenantB", healthB.body);

  const wrongScope = await tokenRequest(
    tenantA.clientId,
    secretA,
    "agentforce:case-analysis"
  );
  logStatus("tenantA.invalidScope", wrongScope.status, 400);

  await pool.query(
    "UPDATE ai_api_tenants SET status = 'suspended', updated_at = now() WHERE tenant_id = $1",
    [tenantB.tenantId]
  );

  const tokenBAfterSuspend = await tokenRequest(
    tenantB.clientId,
    secretB,
    scope
  );
  logStatus("tenantB.suspendedToken", tokenBAfterSuspend.status, 401);

  const healthBAfterSuspend = await projectHealth(
    tokenB.body.access_token,
    `${tenantB.requestId}-after-suspend`
  );
  logStatus(
    "tenantB.suspendedExistingTokenProjectHealth",
    healthBAfterSuspend.status,
    401
  );

  const tokenAStillActive = await tokenRequest(
    tenantA.clientId,
    secretA,
    scope
  );
  logStatus(
    "tenantA.tokenAfterTenantBSuspended",
    tokenAStillActive.status,
    201
  );
} finally {
  await pool.query(
    "UPDATE ai_api_tenants SET status = 'active', updated_at = now() WHERE tenant_id = $1",
    [tenantB.tenantId]
  );
  await pool.end();
  console.log("tenantB.restored=true");

  if (args["remove-secret-files"] === "true") {
    removeSecretFiles([tenantA.secretFile, tenantB.secretFile]);
    console.log("temporarySecretFilesRemoved=true");
  }
}

async function tokenRequest(clientId, clientSecret, requestedScope) {
  const response = await fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: requestedScope
    })
  });
  return { status: response.status, body: await parseResponse(response) };
}

async function projectHealth(accessToken, requestId) {
  const response = await fetch(`${baseUrl}/agent/services/project-health`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      projectReference: requestId,
      projectStatus: "Green",
      percentHoursComplete: 20,
      plannedHours: 1000,
      estimatedHoursAtCompletion: 980,
      marginPercent: 28,
      assignmentCount: 6,
      activeAssignmentCount: 6,
      assignmentAtRiskCount: 0,
      milestoneCount: 4,
      lateMilestoneCount: 0,
      requestId
    })
  });
  return { status: response.status, body: await parseResponse(response) };
}

async function parseResponse(response) {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 300) };
  }
}

function logStatus(name, actual, expected) {
  console.log(`${name}: ${actual}`);
  if (actual !== expected) {
    throw new Error(`${name} expected ${expected} but received ${actual}`);
  }
}

function logClaims(name, accessToken) {
  const claims = decodeClaims(accessToken);
  console.log(
    `${name}.claims tenant=${claims.tenant} client_id=${claims.client_id} scope=${claims.scope}`
  );
}

function logHealth(name, body) {
  console.log(
    `${name}.projectHealthResult healthStatus=${body?.healthStatus} riskLevel=${body?.riskLevel}`
  );
}

function decodeClaims(accessToken) {
  const [, payload] = accessToken.split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

function readSecret(path) {
  const value = readFileSync(path, "utf8").trim();
  if (!value) fail(`${path} did not contain a client secret.`);
  return value;
}

function removeSecretFiles(files) {
  for (const file of files) {
    try {
      unlinkSync(file);
    } catch (err) {
      if (err?.code !== "ENOENT") throw err;
    }
  }
}

function readBoolean(rawValue) {
  if (!rawValue) return false;
  if (rawValue === "true") return true;
  if (rawValue === "false") return false;
  fail("SSL flags must be true or false.");
}

function parseArgs(rawArgs) {
  const parsed = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--")) continue;
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

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
