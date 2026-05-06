---
description: "Use when reviewing authentication, authorization, secrets, PII handling, logging, telemetry, rate limiting, audit trails, or production readiness gates."
applyTo:
  - "force-app/main/default/classes/**"
  - "force-app/main/default/namedCredentials/**"
  - "force-app/main/default/externalCredentials/**"
  - "apps/ai-api/**"
  - "packages/**"
  - "docs/**"
---

# Security And Observability Instructions

- Use least privilege for Salesforce, backend, vector DB, Open WebUI, and customer chat access.
- Never commit secrets, `.env`, private keys, org refresh tokens, production API keys, OpenAI keys, Pinecone keys, or Open WebUI admin tokens.
- Redact raw PII, secrets, access tokens, customer prompt text, retrieved sensitive chunks, and full provider responses from logs.
- Use structured audit records with safe references: request ID, tenant/client ID, user ID hash or allowed identifier, endpoint, provider, model, latency, token counts, retrieval IDs, tool names, and outcome.
- Telemetry must be fail-safe: no-op when disabled and never block the user workflow.
- Rate limit internal and public endpoints. Customer chat requires stricter abuse controls than Open WebUI.
- Add tests for missing auth, invalid token/key, tenant boundary violations, unsafe logging regressions, and provider failure fallbacks.
