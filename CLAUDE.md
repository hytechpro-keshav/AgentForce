# Claude Project Context

@AGENTS.md

---

## Build & Test Commands

| Command                                                                       | Purpose                            |
| ----------------------------------------------------------------------------- | ---------------------------------- |
| `npm run lint`                                                                | JavaScript/LWC lint                |
| `npm run test:unit`                                                           | LWC unit tests (Jest)              |
| `npm run ai-api:test`                                                         | NestJS AI API tests                |
| `npm run ai-api:test:e2e`                                                     | NestJS AI API end-to-end tests     |
| `npm run ai-api:build`                                                        | NestJS AI API build                |
| `npm run ai-api:typecheck`                                                    | NestJS TypeScript type check       |
| `npm run react-chat:typecheck`                                                | React chat TypeScript type check   |
| `npm run prettier:verify`                                                     | Prettier format check              |
| `npm run prettier`                                                            | Prettier auto-fix                  |
| `sf apex run test --test-level RunLocalTests --wait 30 --result-format human` | Salesforce Apex tests              |
| `sf project deploy validate`                                                  | Salesforce metadata dry-run deploy |

Run **focused tests for the touched layer** before completing any task. Never run the full suite unless validating a release.

---

## Session Management & Skill Creation

**At the start of every session** — scan `.claude/commands/` and `.agents/skills/` for any skill relevant to the current task and read it before starting work.

**During a session** — when you solve a tough or long problem, immediately extract the solution as a reusable skill so future sessions can skip the rediscovery:

| What you solved                                       | Where to save                                                |
| ----------------------------------------------------- | ------------------------------------------------------------ |
| Repeatable workflow (scaffold, deploy, debug pattern) | `.claude/commands/<name>.md` → becomes `/name` slash command |
| Contextual coding rule for a file area                | `.claude/rules/<name>.md` with `paths:` frontmatter          |
| Specialized reviewer or implementer persona           | `.claude/agents/<name>.md`                                   |

Keep skill files concise — steps and constraints only, no narration. A future session should be able to read it in under 30 seconds.

---

## Available Skills (`.agents/skills/`)

Read the relevant `SKILL.md` before doing specialized work in these domains:

| Skill                             | When to use                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `langgraph-fundamentals`          | Any LangGraph StateGraph, nodes, edges, streaming                                                       |
| `langgraph-human-in-the-loop`     | Approval pauses, HITL patterns                                                                          |
| `langgraph-persistence`           | Checkpointers, state resume                                                                             |
| `langgraph-case-triage-slice`     | Node 1 case triage orchestrator                                                                         |
| `langgraph-node4-parts-logistics` | Phase 4a Node 4 Parts & Logistics — see also `docs/orchestrator/new-node-phase-completion-checklist.md` |
| `langgraph-node5-scheduling`      | Node 5 Scheduling — plan via `/plan-node5-scheduling` before implementation                             |
| `salesforce-node4-parts-prep`     | Phase 4-Pre Salesforce inventory metadata deploy and validation                                         |
| `langchain-fundamentals`          | LangChain chains, runnables, callbacks                                                                  |
| `langchain-rag`                   | RAG chains, retrievers, document loaders                                                                |
| `langchain-middleware`            | Middleware patterns                                                                                     |
| `langchain-dependencies`          | Package changes, version constraints                                                                    |
| `deep-agents-core`                | Core deep agent patterns                                                                                |
| `deep-agents-orchestration`       | Multi-agent orchestration                                                                               |
| `deep-agents-memory`              | Agent memory systems                                                                                    |
| `managed-deep-agents`             | Managed agent lifecycle                                                                                 |
| `swarm`                           | Swarm coordination patterns                                                                             |
| `framework-selection`             | Choosing the right framework                                                                            |
| `salesforce-case-create`          | Salesforce Case creation from external systems                                                          |
| `railway-quick-deploy`            | Railway deployment                                                                                      |
| `new-org-tenant-onboarding`       | New org/tenant setup                                                                                    |

---

## Available Agents (`.claude/agents/`)

These subagents run in isolated context with specialized system prompts. Invoke them for focused reviews or implementations:

| Agent                               | Use when                                                                |
| ----------------------------------- | ----------------------------------------------------------------------- |
| `security-reviewer`                 | Auth, secrets, PII, CORS, rate limiting, production readiness           |
| `agentforce-reviewer`               | Agentforce metadata, genAiFunctions, planner bundles, deploy risks      |
| `nest-ai-architect`                 | NestJS AI API design, ModelRouter, provider adapters, module boundaries |
| `rag-quality-reviewer`              | RAG retrieval quality, source grounding, tenant isolation               |
| `telemetry-reviewer`                | Observability, `gen_ai.*` conventions, telemetry safety                 |
| `code-review-orchestrator`          | Full cross-cutting code review coordination                             |
| `release-checker`                   | Release readiness, deployment gates                                     |
| `case-triage-slice-implementer`     | Node 1 case triage slice implementation                                 |
| `node4-parts-logistics-implementer` | Phase 4a Node 4 Parts & Logistics implementation                        |
| `node5-scheduling-planner`          | Node 5 Scheduling planning before implementation                        |
| `new-org-tenant-onboarding`         | New org/tenant onboarding workflow                                      |

---

## Custom Slash Commands (`.claude/commands/`)

| Command                                 | Purpose                                                        |
| --------------------------------------- | -------------------------------------------------------------- |
| `/review-ai-change`                     | Review an AI-related code change                               |
| `/create-agentforce-action`             | Scaffold a new Salesforce Agentforce action                    |
| `/add-llm-provider`                     | Add a new LLM provider to the NestJS AI API                    |
| `/create-rag-endpoint`                  | Scaffold a new RAG endpoint                                    |
| `/review-agentforce-metadata`           | Deep review of Agentforce metadata                             |
| `/implement-case-triage-slice`          | Implement the Node 1 case triage LangGraph slice               |
| `/implement-node4-parts-logistics`      | Implement Phase 4a Node 4 Parts & Logistics orchestrator slice |
| `/plan-node5-scheduling`                | Plan Node 5 Scheduling: architecture, SF readiness, phase plan |
| `/onboard-new-org-tenant`               | Run new org/tenant onboarding workflow                         |
| `/generate-production-runbook`          | Generate a production runbook                                  |
| `/service-workflow-architecture-review` | Architecture review of service workflows                       |

---

## Claude Code Configuration

| Path                    | Purpose                                                        |
| ----------------------- | -------------------------------------------------------------- |
| `.claude/settings.json` | Model, permissions, deny-list                                  |
| `.claude/mcp.json`      | CodeTrellis MCP server                                         |
| `.claude/rules/`        | Path-scoped coding rules (load when matching files are edited) |
| `.claude/agents/`       | Custom subagent definitions                                    |
| `.claude/commands/`     | Custom slash commands                                          |

---

## Repository Intelligence

| Folder                  | Purpose                                                                |
| ----------------------- | ---------------------------------------------------------------------- |
| `.github/instructions/` | Scoped coding rules (referenced by `.claude/rules/`)                   |
| `.github/agents/`       | Source of truth for agent personas (symlinked to `.claude/agents/`)    |
| `.github/prompts/`      | Source of truth for task templates (referenced by `.claude/commands/`) |
| `.agents/skills/`       | Detailed skill knowledge for specialized domains                       |
| `docs/adr/`             | Architecture decision records                                          |
| `docs/context/`         | Phase history, lessons learned, reference patterns                     |
| `docs/orchestrator/`    | LangGraph case triage orchestrator design                              |
| `docs/agents/`          | Agent capability and findings docs                                     |

Use CodeTrellis for monorepo context: `codetrellis context <file> --project .`
