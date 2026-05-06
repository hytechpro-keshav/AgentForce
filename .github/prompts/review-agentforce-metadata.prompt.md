---
description: "Review Agentforce metadata for deployability, schemas, planner behavior, security, and eval gaps."
agent: "Agentforce Reviewer"
argument-hint: "Files, branch, or capability to review"
tools: [read, search]
---

Review the selected Agentforce metadata and Apex action surface.

Prioritize:

- Broken or incomplete genAiFunction schema triplets
- Planner-visible descriptions that are ambiguous or unsafe
- Missing Apex tests or HTTP mocks
- Prompt template version risks
- Active-agent or planner-cache deployment risks
- Missing eval prompts or Testing Center coverage
- Secrets, org-specific values, or PII leakage

Return findings first, ordered by severity, then open questions and a short readiness verdict.
