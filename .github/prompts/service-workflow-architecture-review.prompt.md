---
name: "Service Workflow Architecture Review + Remediation"
description: "Review gaps between the shipped Nodes 1–3 orchestrator slice and the target eight-node ServiceWorkflowState, then implement the highest-priority remediations — contracts, orchestrator seams, Node 3 UI clarity, and a ChatGPT-style Final Verdict panel."
agent: "Case Triage Slice Implementer"
argument-hint: "Optional focus (state contracts, graph routing, Node 3 UI, Final Verdict, Node 6 guardrail, Nodes 4–8 readiness)"
tools: [read, search, edit, execute, todo, agent]
agents:
  - "Nest AI Architect"
  - "Security Reviewer"
  - "Telemetry Reviewer"
  - "Release Checker"
---

Use the installed workspace skills for this task.

Required skill-loading order:

1. `framework-selection`
2. `langgraph-fundamentals`
3. `langgraph-human-in-the-loop`
4. `langgraph-persistence`
5. `langgraph-case-triage-slice`
6. `langchain-rag` — Node 3 knowledge guidance and retrieval display

Relevant repo instructions to honor:

- [AGENTS.md](../../AGENTS.md)
- [LangGraph orchestrator instructions](../instructions/langgraph-orchestrator.instructions.md)
- [Nest AI API instructions](../instructions/nest-ai-api.instructions.md)
- [frontend chat instructions](../instructions/frontend-chat.instructions.md)
- [LLM provider instructions](../instructions/llm-provider.instructions.md)
- [security and observability instructions](../instructions/security-observability.instructions.md)
- [telemetry instructions](../instructions/telemetry.instructions.md)
- [testing and eval instructions](../instructions/testing-evals.instructions.md)

Relevant repo references — read these **before** reviewing or changing code:

- [orchestrator flow](../../docs/orchestrator/case-triage-orchestrator-flow.md)
- [Node 2 design](../../docs/orchestrator/node-2-customer-history-agent.md)
- [Node 3 design](../../docs/orchestrator/node-3-knowledge-base-agent.md)
- [case-triage graph](../../apps/ai-api/src/orchestrator/case-triage.graph.ts)
- [orchestrator service](../../apps/ai-api/src/orchestrator/case-triage-orchestrator.service.ts)
- [orchestration UI](../../apps/react-chat-window/components/OrchestrationView.tsx)
- [orchestration sanitization](../../apps/react-chat-window/lib/orchestration.ts)
- [lifecycle DTOs](../../apps/ai-api/src/orchestrator/dto/case-triage-lifecycle.ts)
- [customer context DTOs](../../apps/ai-api/src/orchestrator/dto/customer-context.ts)
- [knowledge guidance DTOs](../../apps/ai-api/src/orchestrator/dto/knowledge-guidance.ts)
- [status event / snapshot DTOs](../../apps/ai-api/src/orchestrator/dto/orchestration-status-event.ts)
- [support triage seam](../../apps/ai-api/src/agents/support-triage.service.ts)

Optional specialist delegation (invoke when the gap touches that surface):

- `Nest AI Architect` — module boundaries, DTO placement, graph design
- `RAG Quality Reviewer` — retrieval grounding, namespace scoping, source citation quality
- `Security Reviewer` — PII in state/events, tenant boundaries, approval channel safety
- `Telemetry Reviewer` — `gen_ai.*` span coverage, no-op safety
- `Code Review Orchestrator` — cross-cutting synthesis before merge

User-provided context:

```text
${input}
```

---

## Persona

You are a **Principal AI Systems Architect** for the AgentForce multi-agent service orchestration platform. Work in **two phases**:

1. **Review** — gap analysis anchored on shipped code and orchestrator design docs.
2. **Remediation** — implement the highest-priority fixes from the review in thin, reviewable slices.

Do **not** scaffold Nodes 4–8 unless `${input}` explicitly asks. Remediation stays within Nodes 1–3 contracts, orchestrator graph seams, UI observability, and documentation — unless the review identifies a blocker that requires a named exception.

Anchor every finding on the **shipped implementation**. Treat working code plus boundary contracts as the reference.

---

## Program invariants (non-negotiable)

- **Salesforce** = system of record **and** action executor. Flow is fire-and-forget trigger only.
- **LangGraph / NestJS orchestrator** = brain. Owns control flow, persistence, retry, and observability.
- **Each node** reads typed shared state, does one job, writes **only its own channel**, and returns control.
- **Downstream nodes branch on structured values** — never parse free-text or prose summaries from upstream agents.
- **ModelRouter only** through existing service seams; no vendor SDK calls in orchestrator or agent services.
- **UI is read-only observability** — no approval controls. Approval happens out-of-band (email / Salesforce) via `POST /:workflowId/resume`.
- **Status events and persisted snapshots** carry sanitized, non-PII `details` only — never raw Case text, customer names, account ids, prompts, tokens, or retrieved chunk content.
- **Human-readable UI copy** (Final Verdict, formatted guidance cards) is **observability-only** — machines consume typed channels, not rendered markdown.

---

## Current state (shipped slice)

The workflow implements **Nodes 1–3** plus a **prototype triage write-back gate** (not yet Node 6 Compliance & Guardrail).

**Graph** (`buildCaseTriageGraph`):

```text
START → readContext → runTriage → customerHistory → knowledge → gate
                                                                  ├─ (approved) writeBack → END
                                                                  └─ (rejected) rejected → END
```

**LangGraph state** (`CaseTriageState`, evolving toward `ServiceWorkflowState`):

| Field                                                      | Owner            | Notes                                           |
| ---------------------------------------------------------- | ---------------- | ----------------------------------------------- |
| `context`                                                  | readContext node | `SalesforceCaseContext`                         |
| `triage`                                                   | Node 1           | `SanitizedTriageResult`                         |
| `customerContext`                                          | Node 2           | `CustomerContextChannel`                        |
| `knowledgeGuidance`                                        | Node 3           | `KnowledgeGuidanceChannel`                      |
| `approvalRequired`, `approvalDecision`, `writeBackApplied` | gate / resume    | Prototype HITL for triage write-back            |
| workflow metadata                                          | orchestrator     | `workflowId`, `caseId`, `tenantId`, `status`, … |

### Node 1 — Triage (`triage` channel)

Produces `SanitizedTriageResult`: `recommendedPriority`, `summary`, `suggestedNextStep`, provider/model/latency metadata. Reuses `SupportTriageService` via `ModelRouter`.

### Node 2 — Customer History (`customerContext` channel)

Produces `CustomerContextChannel` with `CustomerContextPackage`. Each finding uses `CustomerContextFinding<T>` (`value`, `confidence`, `provenance`, `evidenceBasis`, `assertedVsInferred`, `notEvidenced?`). Read-only to Salesforce, non-interrupting, eligibility skip + degraded mode.

### Node 3 — Knowledge Guidance (`knowledgeGuidance` channel)

Produces `KnowledgeGuidanceChannel` with `status` (`ANSWERED` | `NO_SOURCE`) and `answer.safeSummary` + `sources[]`. Read-only to Salesforce; uses `RagRetrievalService`; never stores raw chunk text in state.

### Current approval gate (prototype)

`gate` uses LangGraph `interrupt(...)` for **triage write-back approval** (`ORCHESTRATOR_TRIAGE_APPROVAL_MODE`: `auto` | `always` | `high_risk`). This is **not** target Node 6 — document the migration path.

### Known UI pain (Node 3)

`OrchestrationView` renders `answer.safeSummary` as a single prose block under **"Suggested next step"**. In production this often surfaces as an unreadable wall of concatenated retrieval metadata (`Product: …, Category: …, Issue: …, Symptoms: …, Cause: …`) instead of operator-friendly guidance. Raw JSON is buried in a collapsible **Knowledge guidance JSON** panel. Operators need structured, scannable output — not dump text.

There is **no Final Verdict** panel today. After Nodes 1–3 complete, the orchestrator does not synthesize a single human-readable summary for the operator.

---

## Target architecture (design intent)

| Node | Name                   | Role                                            |
| ---- | ---------------------- | ----------------------------------------------- |
| 4    | Parts & Logistics      | inventory, reserve, delivery ETA                |
| 5    | Scheduling             | technician, skill, location                     |
| 6    | Compliance & Guardrail | **only interrupting node** — composite approval |
| 7    | Resolution & Drafting  | customer comms, work notes                      |
| 8    | Insight & Logging      | trends, recurring failures                      |

Target chain: `N1 → N2 → N3 → N4 → N5 → N6 → N7 → N8`. Only Node 6 pauses the graph.

---

## Phase 1 — Review objectives

Perform gap analysis between the shipped slice and the target architecture. Focus on contract gaps that block autonomous service operations and operator clarity.

### 1. State contract gaps

Compare shipped DTOs under `apps/ai-api/src/orchestrator/dto/` against target `ServiceWorkflowState`. Identify:

- missing DTOs and channel namespaces (`partsLogistics`, `scheduling`, `guardrail`, `resolutionDraft`, `insights`, `orchestratorVerdict`)
- missing typed fields on existing channels
- fields currently embedded in prose (`summary`, `suggestedNextStep`, `safeSummary`)
- confidence / provenance signals downstream agents need
- eligibility / degraded / skip semantics not yet modeled

Recommend **exact TypeScript interfaces** that extend — not replace — shipped contracts.

### 2. Orchestrator gaps

Evaluate against `case-triage.graph.ts` and orchestrator instructions:

- conditional routing and dynamic branching (eligibility skip patterns from Nodes 2–3)
- composite approval logic (prototype gate vs target Node 6)
- human-in-the-loop placement (`interrupt` points, idempotent `Command(resume=…)`)
- state-machine and checkpointer implications for multi-gate workflows
- separation of **observability UI state** from **approval channel**
- **Final Verdict synthesis step** — when and where the orchestrator assembles operator-facing narrative from typed channels

### 3. Node readiness assessment (Nodes 4–8)

For each planned node deliver: current readiness (%), available inputs, missing inputs, required integrations, expected outputs, required state contracts.

### 4. Composite guardrail design (target Node 6)

Design Node 6 to evaluate structured outputs from `triage`, `customerContext`, `knowledgeGuidance`, `partsLogistics`, `scheduling`. Outcomes: `autoApprove`, `requireHumanApproval`, `reject`, `escalate`. Provide decision matrix, confidence model, risk scoring model, and migration path from the triage-only gate.

### 5. Knowledge guidance evolution

Known gap: `KnowledgeAnswer.safeSummary` is synthesized free text that downstream agents must not parse.

Propose a production-grade contract extending `KnowledgeGuidanceChannel`:

```typescript
KnowledgeGuidanceAnswer {
  status: "ANSWERED" | "NO_SOURCE";
  recommendedActions: ActionRecommendation[];
  suggestedParts: PartRecommendation[];
  confidence: EvidenceConfidence;
  safetyFlags: SafetyFlag[];
  sources: KnowledgeSourceRef[];
  /** UI-only observability — NOT a machine input */
  displaySummary?: string;
}
```

### 6. Action contract design

Design a canonical `ActionRecommendation` model shared by Knowledge, Parts, Scheduling, and Resolution:

```typescript
ActionRecommendation {
  actionType:
    | "replace_part"
    | "schedule_visit"
    | "run_diagnostic"
    | "escalate_vendor"
    | "customer_instruction";
  confidence: EvidenceConfidence;
  rationale: string;
  requiredApproval: boolean;
}
```

### 7. UI observability gaps

Review `OrchestrationView.tsx` and `lib/orchestration.ts`. Identify:

| Gap                     | Current behavior                | Target behavior                                                                        |
| ----------------------- | ------------------------------- | -------------------------------------------------------------------------------------- |
| Node 3 guidance display | Single `safeSummary` prose wall | Structured cards: issue match, recommended actions, safety warnings, source chips      |
| Node 3 sources          | Collapsed details panel         | Scannable source list with title, score, version — always visible when ANSWERED        |
| Operator narrative      | None after Node 3               | **Final Verdict** panel — ChatGPT-style readable output                                |
| Machine vs human fields | `safeSummary` used for both     | Typed `recommendedActions[]` for machines; `displaySummary` / Final Verdict for humans |

**Final Verdict requirements:**

- Rendered as a dedicated UI section (e.g. **"Orchestrator verdict"** or **"Final recommendation"**)
- Chat-window quality: short headline, bullet points, numbered steps, bold labels, section breaks — like a ChatGPT assistant message
- Synthesized **after** Nodes 1–3 complete (new graph node or post-knowledge orchestrator step)
- Written to an **observability-only** channel (e.g. `orchestratorVerdict`) separate from machine-consumable fields
- Must **not** expose hidden chain-of-thought, raw prompts, or PII
- Content derived from typed channels (`triage`, `customerContext`, `knowledgeGuidance`) — the verdict text is generated for display, not parsed back by downstream nodes

### 8. Target end-state architecture

Produce: final `ServiceWorkflowState` interface, node responsibilities, channel write-ownership rules, routing rules, approval rules, and four boundary contract alignment (trigger, read context, write-back, status event).

---

## Contract discipline (apply during review and remediation)

### Contract evolution rules

- Prefer additive evolution over replacement; do not break Node 1–3 consumers.
- Existing consumers of `SanitizedTriageResult`, `CustomerContextChannel`, `KnowledgeGuidanceChannel` must keep working.
- New fields optional unless required by the owning node.
- Favor `interface X extends ExistingX` over parallel DTOs.
- For every proposed contract, label: additive | breaking | migration required.

### Channel ownership rules

Every proposed field must specify: owning node, writer, readers, and whether it is authoritative, derived, or observability-only. No field may have multiple writers. If another node must mutate it, recommend a new channel.

### Machine-consumable validation

For every proposed field, answer:

1. Which downstream node consumes it?
2. What decision does it enable?
3. Can that decision be made without parsing text?

If the answer to (3) is no, the contract is incomplete. Flag all prose-only fields.

---

## Phase 2 — Remediation scope

After the review, implement the **highest-priority** fixes in thin slices. Default remediation order:

1. **Node 3 UI clarity** — structured guidance cards in `OrchestrationView`; stop dumping raw `safeSummary` as the primary display
2. **Knowledge DTO extension** — add `recommendedActions[]`, `guidanceConfidence`, optional `displaySummary`; keep `safeSummary` backward-compatible during transition
3. **Final Verdict** — orchestrator synthesis step + `orchestratorVerdict` channel + ChatGPT-style panel in the UI
4. **Contract / graph gaps** from review items 1–2 that block items 1–3
5. **Tests** — DTO validation, graph transitions, UI rendering, sanitization safety

Remediation constraints:

- Keep slices deployable; run focused tests before handing back.
- Reuse `ModelRouter` and existing RAG seams; do not add vendor SDKs.
- Do not build Nodes 4–8 in the same change unless `${input}` explicitly asks.
- Do not put approval controls in the React UI.
- Do not store raw chunk text, PII, or chain-of-thought in state or events.

---

## Post-task repo maintenance (required after remediation)

When contracts, graph behavior, or UI surfaces change, update the repo intelligence layer so future sessions stay aligned:

| Artifact           | Location                                                                                       | When to update                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Skills             | `.agents/skills/` (+ sync `.github/skills/`)                                                   | New orchestrator patterns, RAG display rules, Final Verdict workflow |
| Instructions       | `.github/instructions/langgraph-orchestrator.instructions.md`, `frontend-chat.instructions.md` | New channels, UI panels, synthesis step                              |
| Agents             | `.github/agents/case-triage-slice-implementer.agent.md`, `nest-ai-architect.agent.md`          | Scope expands beyond Node 1 or verdict synthesis                     |
| Orchestrator docs  | `docs/orchestrator/`                                                                           | Implemented graph, DTO shapes, UI observability model                |
| Flow doc §7        | `docs/orchestrator/case-triage-orchestrator-flow.md`                                           | Shipped slice section reflects new nodes/channels                    |
| Cursor rules index | `.cursor/rules/github-agents-and-prompts.mdc`                                                  | New prompts or agents added                                          |
| CodeTrellis matrix | `.codetrellis/cache/AgentForce/matrix.prompt`                                                  | Structural monorepo changes                                          |

Documentation updates happen **after** working code — docs must reflect implemented seams, not aspirational design only.

---

## Expected review outcomes

A complete review should surface these top recommendations (remediate in priority order):

1. Extend `KnowledgeGuidanceChannel` — `recommendedActions[]`, `suggestedParts[]`, `guidanceConfidence`, `displaySummary`
2. Introduce `ServiceWorkflowState` — keep `CaseTriageState` as transitional alias
3. Add `orchestratorVerdict` observability channel + Final Verdict UI panel
4. Fix Node 3 UI — structured guidance display instead of prose wall
5. Plan new channels — `partsLogistics`, `scheduling`, `guardrail`, `resolutionDraft`, `insights`
6. Replace triage-only gate with composite Node 6 (design now, implement later)
7. Add conditional routing keyed on typed fields only

If these outcomes are missing, the analysis stayed too high-level.

---

## Safety rules

- **Do not** bypass `ModelRouter` or add vendor SDK calls.
- **Do not** block Salesforce Flow on graph execution.
- **Do not** put approval controls in the React orchestration UI.
- **Do not** store raw PII, chunk text, or hidden chain-of-thought in workflow state or status events.
- **Do not** create a second triage API contract when existing DTOs can be extended.
- Prefer **evidence-or-abstain** over fabricated confident values.
- Keep context/knowledge packages **descriptive**; operational decisions belong in later nodes; guardrail decisions in Node 6.
- **Final Verdict is human-facing only** — downstream nodes must never parse it.

---

## Output format

### After Phase 1 (Review)

1. **Executive summary** — top blockers to autonomous multi-node operation and operator clarity
2. **Gap analysis table** — area | current | target | severity | owner node
3. **Proposed DTOs** — TypeScript interfaces with file paths under `apps/ai-api/src/orchestrator/dto/`
4. **Updated workflow graph** — Mermaid: shipped vs target, interrupt points marked
5. **Guardrail design** — Node 6 matrix, confidence model, migration from prototype gate
6. **UI remediation plan** — Node 3 structured display + Final Verdict wireframe (sections, not pixel mockups)
7. **Final `ServiceWorkflowState` interface**
8. **Implementation roadmap** — ordered slices for Phase 2

### After Phase 2 (Remediation)

1. **Changes shipped** — files, contracts, graph nodes, UI components
2. **Repo maintenance completed** — skills, instructions, agents, docs updated (list each)
3. **Validation run** — commands and results (`npm run ai-api:test`, frontend tests, lint as applicable)
4. **Before / after** — Node 3 display and Final Verdict behavior
5. **Residual risks** and exact next thin step

Always include: skills and instructions consulted, specialist agents invoked, design-doc vs code divergences, open questions.

Assume the system will eventually support **autonomous service operations** and must **never require agents to parse free-text outputs from other agents** — while operators still receive **human-readable verdicts** in the observability UI.
