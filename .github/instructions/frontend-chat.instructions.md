---
description: "Use when editing the React/Vite customer chat window, chat widget, customer-safe chat UX, escalation flows, sources display, or frontend API clients."
applyTo:
  - "apps/react-chat-window/**"
  - "chat-widget/**"
---

# Frontend Chat Instructions

- Build the actual chat experience as the first screen, not a marketing landing page.
- The customer chat window talks only to NestJS `/chat/message` and approved escalation endpoints. It must not call OpenAI, Pinecone, Salesforce secrets, or Open WebUI directly.
- Treat customer chat as stricter than internal chat: customer identity, session state, rate limiting, safe escalation, and source display all matter.
- Show answer sources when available, but do not expose internal-only document IDs, raw retrieval payloads, or sensitive Salesforce fields.
- Keep UI controls compact and operational. Use clear loading, streaming, error, retry, and escalation states.
- Add responsive checks for mobile and desktop. Text must not overlap, overflow controls, or rely on viewport-scaled font sizes.
- Frontend tests should cover message send, streaming display, error fallback, source rendering, and escalation handoff.
