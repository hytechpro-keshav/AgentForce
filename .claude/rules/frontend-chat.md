---
paths:
  - "apps/react-chat-window/**"
  - "apps/openwebui/**"
---

Read and follow `.github/instructions/frontend-chat.instructions.md` before editing these files.

Key constraints:
- React chat must call the NestJS chat API — never call any LLM provider directly
- Open WebUI must call the NestJS OpenAI-compatible gateway — never call OpenAI directly
- If Salesforce hosts the chat shell: validate CSP, iframe/clickjack settings, CORS, and guest-user behavior
- Apply customer-safe rate limiting, identity/session rules, and approved Salesforce actions on the public endpoint

Build: `npm run react-chat:build`
Dev: `npm run react-chat:dev`
Test: `npm run react-chat:test`
Type check: `npm run react-chat:typecheck`
