---
description: "Use when configuring Railway services, Dockerfiles, Open WebUI deployment, service env vars, persistent storage, health checks, or production runbooks."
applyTo:
  - "apps/openwebui/**"
  - "**/railway.json"
  - "**/Dockerfile"
  - "**/docker-compose*.yml"
  - "docs/**/railway*.md"
---

# Railway And Open WebUI Instructions

- Railway should host the NestJS API, React chat window, and Open WebUI service. Pinecone remains external.
- Open WebUI must use the NestJS OpenAI-compatible base URL and a gateway key. It must not receive the real OpenAI API key.
- Configure auth/RBAC before sharing Open WebUI internally.
- Document persistent storage, backups, retention, environment variables, service URLs, and rollback steps.
- Health checks should be lightweight and should not call OpenAI or Pinecone unless explicitly marked deep health.
- Railway env vars belong in the Railway dashboard or secure deployment system. Keep `.env.example` only.
- Production notes should include cold-start behavior, expected latency, token/cost alerting, and incident contacts.
