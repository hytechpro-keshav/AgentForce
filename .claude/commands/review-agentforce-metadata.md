# Review Agentforce Metadata

Deep review of Salesforce Agentforce metadata. Full details in `.github/prompts/review-agentforce-metadata.prompt.md`.
Adopt the persona from `.claude/agents/agentforce-reviewer.agent.md`.

## Review Checklist

1. **genAiFunction schemas** — narrow action scope, complete input/output schema, planner-readable description?
2. **Planner bundle** — topic/action bindings correct, no stale planner cache risk?
3. **Prompt templates** — version identifiers stable, no fragile schema-only edits without sibling metadata?
4. **Apex actions** — `@InvocableMethod` present, bulk-safe (List in/out), HTTP mocks in tests?
5. **Named Credentials** — all callouts use Named/External Credentials, no hardcoded endpoints?
6. **Permission sets** — correct object/field permissions, no over-privileged guest access?
7. **Eval coverage** — each action has eval prompts or Testing Center coverage?
8. **Deploy risks** — active agents that could block deploy, planner bundles that need reactivation?

Report findings ordered by severity with file references and a readiness verdict.

Run validate before recommending deploy: `sf project deploy validate --source-dir force-app/`
