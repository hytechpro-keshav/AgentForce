#!/usr/bin/env node
import jwt from "jsonwebtoken";

const args = parseArgs(process.argv.slice(2));
const secret = process.env.AI_API_JWT_SECRET;
if (!secret) {
  fail("AI_API_JWT_SECRET is required in the environment.");
}

const ttlSeconds = readTtl(args["ttl-seconds"] ?? process.env.JWT_TTL_SECONDS);
const nowSeconds = Math.floor(Date.now() / 1000);
const payload = {
  sub: args.sub ?? process.env.JWT_SUB ?? "openwebui-internal-console",
  scope: args.scope ?? process.env.JWT_SCOPE ?? "openwebui:chat",
  tenant: args.tenant ?? process.env.JWT_TENANT ?? "tenant-demo",
  rag_namespace:
    args.namespace ??
    process.env.JWT_RAG_NAMESPACE ??
    process.env.RAG_DEFAULT_NAMESPACE ??
    "customer-self-service",
  roles: readCsv(args.roles ?? process.env.JWT_ROLES ?? "support-agent"),
  iat: nowSeconds,
  exp: nowSeconds + ttlSeconds
};

const issuer = args.issuer ?? process.env.JWT_ISSUER ?? process.env.AI_API_JWT_ISSUER;
const audience =
  args.audience ?? process.env.JWT_AUDIENCE ?? process.env.AI_API_JWT_AUDIENCE;
const signOptions = {
  algorithm: "HS256",
  ...(issuer ? { issuer } : {}),
  ...(audience ? { audience } : {})
};

const token = jwt.sign(payload, secret, signOptions);

process.stdout.write(`${token}\n`);

function parseArgs(rawArgs) {
  const parsed = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--")) {
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

function readTtl(rawTtl) {
  const ttl = Number(rawTtl ?? "604800");
  if (!Number.isInteger(ttl) || ttl < 300 || ttl > 2592000) {
    fail("JWT TTL must be an integer from 300 to 2592000 seconds.");
  }
  return ttl;
}

function readCsv(rawValue) {
  return rawValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
