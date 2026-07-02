# Ablypro Landing + Intake Chatbot

Work on the Ablypro marketing landing page (`/landing`) and the floating intake chatbot (AI triage → device picker → Salesforce Case).

Read `.agents/skills/ablypro-landing-intake-chat/SKILL.md` first.

## Before editing

1. Reference parity source: `Ablypro Landing.html`
2. Plan doc: `docs/sleepy-sparking-newt.md`
3. If OTP is blocked, use `/enable-intake-skip-email-verification` or skill `intake-skip-email-verification`

## Key files

- `apps/react-chat-window/components/LandingPage.tsx`
- `apps/react-chat-window/components/LandingChatPanel.tsx`
- `apps/react-chat-window/lib/intake-flow.ts`
- `apps/ai-api/src/intake/` (controller, bootstrap, agent, case create)

## Test

```bash
npm run react-chat:typecheck
npm run ai-api:test -- --testPathPattern=intake
REACT_CHAT_URL=https://react-chat-window-production.up.railway.app \
  npm run test:e2e --workspace @agentforce/react-chat-window -- e2e/landing-page.spec.ts
```

## Deploy

`SERVICE=react-chat-window` for UI-only; `SERVICE=all` when intake API changes.

$ARGUMENTS
