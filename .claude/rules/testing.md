---
paths:
  - "**/*.spec.ts"
  - "**/*.test.ts"
  - "**/*.spec.js"
  - "**/*.test.js"
  - "agent-eval/**"
  - "force-app/**/test*/**"
---

Read and follow `.github/instructions/testing-evals.instructions.md` before editing test files.

Testing requirements by layer:
- **Salesforce/Apex**: bulk-safe tests, HTTP mocks for all callouts, Testing Center or eval coverage for Agentforce behavior
- **NestJS backend**: unit tests, DTO validation, mocked provider tests, auth guard tests, e2e for public contracts
- **RAG**: source-grounding checks, retrieval quality, tenant/access-control isolation
- **React/LWC UI**: responsive checks, user-facing workflow verification

Run focused tests for the touched layer: `npm run ai-api:test` or `npm run test:unit`
Never run the full suite unless validating a release.
