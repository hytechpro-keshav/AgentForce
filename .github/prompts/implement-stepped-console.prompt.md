---
name: implement-stepped-console
description: "Implement or fix the stepped orchestration console, demo bootstrap, advance UX, or stepped-console docs."
argument-hint: "Bug, new node in spine, demo flow, or proxy scope"
user-invocable: true
---

# Implement Stepped Orchestration Console

Read first:

- Skill: `.agents/skills/langgraph-stepped-console/SKILL.md`
- Phase plan: `docs/orchestrator/stepped-console-phase-plan.md`
- Instructions: `.github/instructions/langgraph-orchestrator.instructions.md`

## Task

$ARGUMENTS

## Checklist

### Stepped UX

- [ ] Demo create → `?workflowId=wf-…` + `orchestrator_session` cookie
- [ ] Triage RUNNING animation → DONE → next Run button (no stuck `runningIndex`)
- [ ] Queued copy: **Waiting for agent output**
- [ ] Guardrail `waiting_approval`: amber WAITING dot/badge/trace
- [ ] `?caseId=` without stepped run → start panel (not auto-run replay)

### Backend (if touched)

- [ ] `triggerStepped` + `advance` scoped with `agentforce:orchestrator-step`
- [ ] `awaiting_step` events in snapshot for `isSteppedSnapshot`
- [ ] Demo create returns `steppedWorkflowId`

### Tests

- [ ] `stepped-view-model.test.ts`
- [ ] `SteppedOrchestrationView.test.tsx` (include triage bootstrap poll test)
- [ ] `demo-case-proxy.test.ts` when demo route changes

### Docs

- [ ] Update `stepped-console-phase-plan.md` if behavior changed
- [ ] Update `demo-case-create-proof.md` with proof row when validated live

## Deploy

```bash
SERVICE=all ./scripts/deploy/railway-quick-deploy.sh
```

Proof: `/demo/case-create` → stepped console → advance each stage manually.
