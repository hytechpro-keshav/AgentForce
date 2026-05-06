# Project Memory

- This repo is the Salesforce Agentforce workspace unless the user explicitly asks to scaffold external platform code here.
- The NestJS/Railway/OpenAI/LangChain/Pinecone/Open WebUI plan.
- First milestone: Agentforce -> Apex -> Named Credential -> Railway NestJS -> structured response -> Agentforce.
- Open WebUI is production internal chat. It calls the NestJS OpenAI-compatible gateway, not OpenAI directly.
- React chat is customer-facing and must use customer-safe policy, identity/session rules, rate limits, and escalation guardrails.
- React chat may be embedded in Experience Cloud or another Salesforce-hosted page shell, but the React codebase and backend lifecycle remain in the external platform.
- Agent services call `ModelRouter`; `ModelRouter` calls provider adapters.
- OpenAI is production v1. Anthropic, Azure OpenAI, Gemini, and OpenAI-compatible self-hosted providers remain extension paths.
- Pinecone is production v1 vector DB. Keep vector DB access behind an interface.
- Agentforce behavior changes need eval prompts or Testing Center cases.
- Production go-live requires UAT, security review, release approval, observability, rollback, and readiness gates.
