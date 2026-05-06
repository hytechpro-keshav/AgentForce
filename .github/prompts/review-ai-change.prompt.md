---
description: "Run a specialist architecture review over a cross-cutting AI, Agentforce, RAG, security, telemetry, or release change."
agent: "Code Review Orchestrator"
argument-hint: "Files, diff, PR, or feature to review"
tools: [read, search, agent]
---

Review the selected change using the smallest useful specialist set.

Focus on behavioral regressions, contract breaks, missing tests, security gaps, observability gaps, and release blockers. Avoid generic style commentary unless it creates real production risk.

Return findings first, then specialist coverage, open questions, and a final readiness verdict.
