# Service Workflow Remediation Backlog

Tracks the review + remediation work from
`.github/prompts/service-workflow-architecture-review.prompt.md`. Updated as
slices ship. Source of truth for remediation priority order; keep aligned with
the shipped code under `apps/ai-api/src/orchestrator/` and
`apps/react-chat-window/`.

## Shipped

### P1 — Node 3 UI clarity (done)

- `apps/react-chat-window/components/OrchestrationView.tsx` renders Node 3
  guidance as scannable label/value cards (`GuidanceDetail` + `parseGuidanceFields`),
  with a readable-prose fallback. Retrieved sources are **always visible** when
  `ANSWERED` (no longer hidden in a collapsed panel). Raw JSON stays collapsible.
- Tests: `components/__tests__/OrchestrationView.test.tsx`.

### P3 — Final Verdict (done)

Observability-only operator narrative synthesized **after Nodes 1-3**, in a
dedicated `orchestratorVerdict` channel separate from machine-consumable fields.

- Contract: `apps/ai-api/src/orchestrator/dto/orchestrator-verdict.ts`
  (`OrchestratorVerdict`, `OrchestratorVerdictInput`).
- Synthesis: `apps/ai-api/src/orchestrator/orchestrator-verdict.synthesizer.ts`
  — pure, deterministic, **no LLM call, no PII, no chain-of-thought**. Derived
  only from the sanitized typed channels (`triage`, `customerContext`,
  `knowledgeGuidance`). Raw knowledge chunk text is never embedded.
- Wiring: computed as a post-knowledge step in
  `CaseTriageOrchestratorService.settleAfterInvoke()` for the `done`,
  `rejected`, and `waiting_approval` paths; persisted via
  `OrchestrationStatusStore` on `CaseTriageWorkflowSnapshot.orchestratorVerdict`.
- UI: `FinalVerdict` panel (headline, summary, highlights, numbered steps) at the
  top of `OrchestrationPanel`; sanitized defensively by
  `lib/orchestration.ts` `sanitizeVerdict`. Read-only, with an explicit
  "downstream automation uses the typed channels, not this text" note.
- Tests: `orchestrator-verdict.synthesizer.spec.ts`, plus UI render and
  sanitization tests.

> Note: the verdict is synthesized in the orchestrator service rather than as a
> new graph node, to keep it out of the LangGraph checkpoint and purely in the
> read model. If a future node needs to act on a verdict-like signal, add a
> typed channel — never parse this display text.

### P2 — Knowledge guidance DTO extension (done, additive)

Extended `KnowledgeAnswer` in
`apps/ai-api/src/orchestrator/dto/knowledge-guidance.ts` with typed,
machine-consumable fields so downstream agents stop parsing `safeSummary`:

```typescript
recommendedActions?: ActionRecommendation[]; // canonical action model
suggestedParts?: PartRecommendation[];
guidanceConfidence?: EvidenceConfidence;     // reused from customer-context
safetyFlags?: KnowledgeSafetyFlag[];
displaySummary?: string;                      // UI-only, preferred over safeSummary
```

Shipped:

- New contracts: `ActionRecommendation` (`KnowledgeActionType` union, confidence,
  rationale, requiredApproval), `PartRecommendation`, `KnowledgeSafetyFlag`.
- `safeSummary` kept (marked deprecated-for-machines) as a display fallback —
  **additive, no breaking change**.
- Producer: `CaseTriageOrchestratorService.retrieveKnowledge` populates
  `guidanceConfidence` deterministically via `knowledge-confidence.ts`
  (`deriveGuidanceConfidence`, graded from top retrieval score).
- **Node 3 answer-extraction (done):** `KnowledgeGuidanceExtractor`
  (`knowledge-guidance-extractor.service.ts`) distills the retrieved chunks into
  typed `recommendedActions[]`, `suggestedParts[]`, `safetyFlags[]`, and
  `displaySummary` via `ModelRouter` (no vendor SDK), grounded only on the
  authorized excerpts. It is **best-effort and abstaining**: malformed JSON,
  invalid `actionType`/`severity`, or any provider error yields an empty
  extraction so the deterministic, score-based guidance survives. Output is
  redacted (`redactSensitiveText`), length-clamped, and array-capped. The
  orchestrator stamps each action/part with the deterministic
  `guidanceConfidence` rather than trusting model self-report. Gated by
  `AI_API_ORCHESTRATOR_KNOWLEDGE_EXTRACTION_ENABLED` (default `true`, but only
  runs when `AI_API_ORCHESTRATOR_KNOWLEDGE_ENABLED` is also `true`, so off by
  default overall).
- Consumers updated to prefer typed fields: the Final Verdict synthesizer uses
  `recommendedActions[].rationale` for steps (falls back to source titles) and
  surfaces `guidanceConfidence`; the Node 3 UI renders `recommendedActions`,
  `safetyFlags`, a confidence card, and prefers `displaySummary` over `safeSummary`.
- Tests: `knowledge-confidence.spec.ts`, `knowledge-guidance-extractor.spec.ts`,
  extended `orchestrator-verdict.synthesizer.spec.ts`, extended frontend
  `OrchestrationView.test.tsx` + `orchestration.test.ts`.

P2 is now complete end-to-end: contracts, deterministic confidence, the LLM
extraction producer, and every consumer ship together.

### Introduce `ServiceWorkflowState` (transitional alias)

- Add `ServiceWorkflowState` extending the current `CaseTriageState`; keep
  `CaseTriageState` as a transitional alias so Node 1-3 consumers keep working.
- Reserve future channel namespaces (design only, no behavior yet):
  `partsLogistics`, `scheduling`, `guardrail`, `resolutionDraft`, `insights`.

### Composite Node 6 guardrail (PLANNED — 2026-06-16)

> **Phase plan:** [`docs/orchestrator/node-6-guardrail-phase-plan.md`](./node-6-guardrail-phase-plan.md)

- Replace the prototype triage-only `gate` (`interrupt` in `case-triage.graph.ts`)
  with `evaluateGuardrail` — composite policy over all five typed channels
  (`triage`, `customerContext`, `knowledgeGuidance`, `partsLogistics`, `scheduling`).
- Outcomes: `autoApprove | requireHumanApproval | reject | escalate`. Decision matrix
  (12 scenarios), risk scoring model (0–100), and migration path documented in phase plan §3.5–§3.6.
- Node 6 remains the **only** interrupting node. Shipping Node 6 unblocks 5c
  `ServiceAppointment` writes. Next: `/implement-node6-guardrail` (6a slice).

### Conditional routing keyed on typed fields only

- Add eligibility-skip / branch routing that reads typed channel values, never
  prose. Mirror the Node 2/3 eligibility patterns.

### Re-orchestration + Stop AI orchestration (design now, implement per phase)

> **Source of truth:** [`docs/orchestrator/re-orchestration-backlog.md`](./re-orchestration-backlog.md)

The orchestrator is **point-in-time per trigger**. Nodes 1–4 read Salesforce once per run; channel outputs go stale when Cases, inventory, transfers, or human actions change.

| Priority | Item                                                      | Notes                                                                    |
| -------- | --------------------------------------------------------- | ------------------------------------------------------------------------ |
| P0       | **Stop AI orchestration** (UI button + API + Case flag)   | Operator manual takeover; block future auto-triggers                     |
| P0       | **Flow trigger guard**                                    | `Case_Triage_Orchestrator_Handoff` respects `AI_Orchestration_Status__c` |
| P1       | **Reconcile API**                                         | Partial re-run from `parts` (and later `parts → scheduling`)             |
| P1       | **Fresh read at write time**                              | Parts 4c + scheduling 5c must re-read upstream before DML                |
| P1       | **Event-driven reconcile (5d)**                           | Transfer complete → refresh parts + scheduling                           |
| P2       | Trigger `correlationId` idempotency; durable checkpointer |

Node 5 phase plan §3.7 splits: **5a** point-in-time, **5c** write-time fresh read, **5d** event reconcile.

## Carried over — operational items from the broader review

These came out of the parallel Salesforce metadata review and the case-triage
Node 1 readiness review (see chat history); tracked here so they are not lost.

### Salesforce / Agentforce metadata

- Parameterize per-environment Named Credential URLs (prod Railway URL is
  hardcoded in `Agentforce_AI_API*` namedCredentials).
- Add missing bot metadata (Customer Self-Service + planner-only agents) or
  document org-only ownership.
- Set `isConfirmationRequired=true` on `Analyze_Revenue_Portfolio_Intelligence`.
- Consolidate duplicate Services Org Intelligence agents; retire temporary
  customer proof topics; resolve Qdrant/Pinecone doc drift; add evals for
  Sales/Scheduling/Service agents; fix `OpportunityController` sharing/limits/tests.

### Case-triage orchestrator (Node 1 live proof + durability)

- Run and document one **live** Salesforce-backed Node 1 E2E proof on the
  connected `AgentForce` org (deploy/route, outbound `SF_OAUTH_*`, Named
  Credential JWT scope `agentforce:orchestrator-triage`, UI view token).
- Implement trigger idempotency using `correlationId` (currently validated but
  unused — duplicate re-fires create new workflows).
- Move the LangGraph checkpointer off in-memory `MemorySaver` so approval resume
  survives an ai-api restart; persist `processedResumeKeys` likewise.
