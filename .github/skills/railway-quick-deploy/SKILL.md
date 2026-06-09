---
name: railway-quick-deploy
description: >-
  Deploy current workspace changes to Railway production for AgentForce monorepo
  services (ai-api, react-chat-window, openwebui). Auto-detects target service
  from git diff, runs railway up, polls until SUCCESS, and smoke-checks health.
  Use when the user asks to deploy, redeploy, ship, push to Railway, or deploy
  current/local/changed code quickly.
argument-hint: "Optional SERVICE=ai-api|react-chat-window|openwebui|all and deploy message"
user-invocable: true
---

# Railway Quick Deploy

Deploy **uncommitted local workspace** changes to Railway production. No git commit required — `railway up` uploads the current tree.

Also read [use-railway](../../../.claude/skills/use-railway/SKILL.md) for auth, telemetry prefixes, and failure triage.

## Services

| Service             | Changed paths                                                        | Health smoke       |
| ------------------- | -------------------------------------------------------------------- | ------------------ |
| `ai-api`            | `apps/ai-api/**`, `packages/**`, root `railway.json`, `package.json` | `GET /health/live` |
| `react-chat-window` | `apps/react-chat-window/**`                                          | `GET /`            |
| `openwebui`         | `apps/openwebui/**`                                                  | service-specific   |

Production URLs (override with env if needed):

- `AI_API_BASE_URL=https://ai-api-production-03f5.up.railway.app`
- `REACT_CHAT_URL=https://react-chat-window-production.up.railway.app`

Railway project: `agentforce-ai-api`. Always deploy from **repo root**; Railway service root directories are configured in the dashboard.

## Fast path (preferred)

Run the repo script — do not reinvent deploy logic:

```bash
chmod +x scripts/deploy/railway-quick-deploy.sh   # once, if needed
./scripts/deploy/railway-quick-deploy.sh
```

Explicit service:

```bash
SERVICE=react-chat-window ./scripts/deploy/railway-quick-deploy.sh
SERVICE=ai-api MESSAGE="Node 3 RAG wiring" ./scripts/deploy/railway-quick-deploy.sh
SERVICE=all ./scripts/deploy/railway-quick-deploy.sh
```

## Manual fallback

When the script is unavailable:

```bash
RAILWAY_CALLER="skill:railway-quick-deploy@1.0.0" \
RAILWAY_AGENT_SESSION="quick-deploy-$(date +%s)" \
railway whoami

cd /path/to/AgentForce
RAILWAY_CALLER="skill:railway-quick-deploy@1.0.0" \
RAILWAY_AGENT_SESSION="quick-deploy-<same-id>" \
railway up --service <service> --environment production --detach -m "<short summary>"
```

Poll until `SUCCESS`, then smoke the health URL. On `Unauthorized`, tell the user to run `railway login`.

## Auto-detect rules

1. `git diff --name-only HEAD` + staged + untracked paths
2. Map paths → service(s) using the table above
3. If multiple services match, deploy each sequentially
4. If none match, ask the user which `SERVICE` to deploy

## Post-deploy extras (only when relevant)

| Change type                   | Extra step                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| RAG corpus / Node 3 knowledge | `./scripts/smoke/deploy-node3-laptop-kb.sh` or ingest via `phase4-rag-ingest-sample.sh` |
| Orchestrator env vars only    | `railway variable set ... --skip-deploys` then redeploy **without** `--skip-deploys`    |
| Full 3-node proof             | `SF_CASE_ID=<Case Id> ./scripts/smoke/all-3-nodes-deployed.sh`                          |

Do **not** print Railway variable values or secrets.

## User phrases → action

| User says                          | Do                                                                   |
| ---------------------------------- | -------------------------------------------------------------------- |
| "deploy my changes"                | Run script with auto-detect                                          |
| "deploy react chat"                | `SERVICE=react-chat-window ./scripts/deploy/railway-quick-deploy.sh` |
| "deploy ai-api" / "deploy backend" | `SERVICE=ai-api ./scripts/deploy/railway-quick-deploy.sh`            |
| "redeploy everything"              | `SERVICE=all ./scripts/deploy/railway-quick-deploy.sh`               |

## Report back

Return:

- service name(s) deployed
- deployment id and status
- smoke check HTTP result
- public URL
- whether other local changes still need a different service deploy
