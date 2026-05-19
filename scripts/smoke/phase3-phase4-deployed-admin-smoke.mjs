#!/usr/bin/env node
import { createHash } from "crypto";
import { readFileSync } from "fs";
import jwt from "jsonwebtoken";

const args = parseArgs(process.argv.slice(2));
const baseUrl = removeTrailingSlash(
  args["base-url"] ?? process.env.AI_API_BASE_URL
);
const tenantId = args["tenant-id"] ?? "phase3-phase4-smoke-org";
const clientId = args["client-id"];
const clientSecretFile = args["client-secret-file"];
const scope = args.scope ?? "agentforce:services-project-health";

if (!baseUrl) fail("AI_API_BASE_URL or --base-url is required.");

const adminToken = readAdminToken();

const setup = await jsonRequest(
  `${baseUrl}/admin/tenants/${encodeURIComponent(tenantId)}/salesforce-setup`,
  { headers: { authorization: `Bearer ${adminToken}` } }
);
logStatus("salesforceSetup", setup.status, 200);
assert(
  setup.body?.oauthClient?.secretHandling?.valuePrinted === false,
  "setup response must not print client secrets"
);
assert(
  !JSON.stringify(setup.body).includes("client_secret"),
  "setup response must not include raw client_secret fields"
);

const report = await jsonRequest(
  `${baseUrl}/admin/tenants/${encodeURIComponent(tenantId)}/report`,
  { headers: { authorization: `Bearer ${adminToken}` } }
);
logStatus("tenantReport", report.status, 200);
assert(
  report.body?.tenantId === tenantId,
  "tenant report must match the requested tenant"
);
console.log(`readiness=${(report.body?.readiness ?? []).join(",")}`);
console.log(`alerts=${(report.body?.alerts ?? []).join(",")}`);

if (clientId && clientSecretFile) {
  const clientSecret = readSecret(clientSecretFile);
  const token = await tokenRequest(clientId, clientSecret, scope);
  logStatus("oauthToken", token.status, 201);
  const claims = jwt.decode(token.body.access_token) ?? {};
  console.log(
    `tokenClaims=tenant:${claims.tenant};client:${claims.client_id};scope:${claims.scope}`
  );

  if (args["expect-second-token-429"] === "true") {
    const secondToken = await tokenRequest(clientId, clientSecret, scope);
    logStatus("oauthTokenSecondAttempt", secondToken.status, 429);
  }
} else {
  console.log(
    "oauthToken=skipped; provide --client-id and --client-secret-file to request a scoped token"
  );
}

console.log("secretMaterialPrinted=false");

async function tokenRequest(oauthClientId, clientSecret, requestedScope) {
  return jsonRequest(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: oauthClientId,
      client_secret: clientSecret,
      scope: requestedScope
    })
  });
}

async function jsonRequest(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  return { status: response.status, body };
}

function readAdminToken() {
  const tokenFile = args["admin-token-file"];
  if (tokenFile) return readSecret(tokenFile);

  const jwtSecretFile = args["jwt-secret-file"];
  const jwtSecret = jwtSecretFile
    ? readSecret(jwtSecretFile)
    : process.env.AI_API_JWT_SECRET;
  if (!jwtSecret) {
    fail(
      "Provide --admin-token-file, --jwt-secret-file, or AI_API_JWT_SECRET."
    );
  }

  return jwt.sign(
    {
      sub: "phase3-phase4-admin-smoke",
      scope: "tenant:admin",
      tenant: "internal-admin",
      roles: ["tenant-admin"]
    },
    jwtSecret,
    {
      algorithm: "HS256",
      expiresIn: "10m",
      ...(process.env.AI_API_JWT_ISSUER
        ? { issuer: process.env.AI_API_JWT_ISSUER }
        : {}),
      ...(process.env.AI_API_JWT_AUDIENCE
        ? { audience: process.env.AI_API_JWT_AUDIENCE }
        : {})
    }
  );
}

function readSecret(path) {
  const value = readFileSync(path, "utf8").replace(/\r?\n$/, "");
  if (!value) fail(`${path} did not contain a secret value.`);
  return value;
}

function logStatus(name, actual, expected) {
  console.log(`${name}.status=${actual}`);
  if (actual !== expected) {
    fail(`${name} expected HTTP ${expected} but received HTTP ${actual}.`);
  }
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function removeTrailingSlash(value) {
  return value ? value.replace(/\/$/, "") : value;
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

function fail(message) {
  console.error(message);
  console.error(`diagnosticHash=${safeHash(message)}`);
  process.exit(1);
}
