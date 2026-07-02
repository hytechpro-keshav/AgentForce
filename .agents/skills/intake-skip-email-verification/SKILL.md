---
name: intake-skip-email-verification
description: >-
  Enable or disable CUSTOMER_INTAKE_SKIP_EMAIL_VERIFICATION so the Ablypro
  landing/intake chatbot bypasses Salesforce OTP email and bootstraps from a
  configured Account Id. Use when OTP is rate-limited, for UAT case-create
  testing, or when re-enabling email verification after limits reset.
argument-hint: "Optional on|off and ACCOUNT_ID=001..."
user-invocable: true
---

# Intake Skip Email Verification

Temporarily bypass Salesforce OTP email verification for the guided intake chatbot. Identity is bound server-side to a **configured Salesforce Account** (primary Contact on that account) — never client-supplied.

Full product plan: `docs/sleepy-sparking-newt.md`. Landing + chat UX: skill `ablypro-landing-intake-chat`.

## When to use

| Situation                                 | Action                         |
| ----------------------------------------- | ------------------------------ |
| Salesforce daily email limit hit (15/day) | **Enable** skip                |
| UAT: test AI → device pick → Case create  | **Enable** skip                |
| Production identity verification ready    | **Disable** skip (restore OTP) |

## Environment variables

Set on **both** `ai-api` and `react-chat-window` (Railway production or local `.env`):

| Variable                                  | Service         | Purpose                                           |
| ----------------------------------------- | --------------- | ------------------------------------------------- |
| `CUSTOMER_INTAKE_ENABLED`                 | both            | Master gate (`true` required)                     |
| `CUSTOMER_INTAKE_SKIP_EMAIL_VERIFICATION` | both            | `true` = skip OTP; `false` = normal email+OTP     |
| `CUSTOMER_INTAKE_BOOTSTRAP_ACCOUNT_ID`    | **ai-api only** | Salesforce Account Id (e.g. `001g500000BsP8BAAV`) |

Default bootstrap account in `.env.example`: `001g500000BsP8BAAV` (laptop assets registered on this account).

## Enable skip (Railway production)

From repo root:

```bash
railway variable set \
  CUSTOMER_INTAKE_ENABLED=true \
  CUSTOMER_INTAKE_SKIP_EMAIL_VERIFICATION=true \
  CUSTOMER_INTAKE_BOOTSTRAP_ACCOUNT_ID=001g500000BsP8BAAV \
  --service ai-api --environment production --skip-deploys

railway variable set \
  CUSTOMER_INTAKE_ENABLED=true \
  CUSTOMER_INTAKE_SKIP_EMAIL_VERIFICATION=true \
  --service react-chat-window --environment production --skip-deploys

SERVICE=all MESSAGE="Enable intake skip-email-verification" \
  ./scripts/deploy/railway-quick-deploy.sh
```

Use skill `railway-quick-deploy` if only one service changed.

## Disable skip (restore OTP)

```bash
railway variable set CUSTOMER_INTAKE_SKIP_EMAIL_VERIFICATION=false \
  --service ai-api --environment production --skip-deploys

railway variable set CUSTOMER_INTAKE_SKIP_EMAIL_VERIFICATION=false \
  --service react-chat-window --environment production --skip-deploys

SERVICE=all ./scripts/deploy/railway-quick-deploy.sh
```

OTP also requires Salesforce `AgentforceOtpRest` + verified OrgWideEmailAddress (see plan doc).

## Verify

```bash
# Config should show bootstrapAvailable: true when skip is on
curl -s https://react-chat-window-production.up.railway.app/api/intake/config

# Bootstrap mints a verified-intake JWT (ai-api behind BFF)
curl -s -X POST https://react-chat-window-production.up.railway.app/api/intake/session/bootstrap
```

Playwright (landing chat skips email when bootstrap on):

```bash
REACT_CHAT_URL=https://react-chat-window-production.up.railway.app \
  npm run test:e2e --workspace @agentforce/react-chat-window -- e2e/landing-page.spec.ts \
  --grep "floating chat"
```

## Security notes

- Bootstrap endpoint returns **503** when skip flag is off — fail-closed.
- `bootstrapAccountId` is **server-only**; clients cannot pass an Account Id.
- Re-enable OTP before customer-facing production; skip is for dev/UAT and email-limit workarounds.

## Key code paths

| Layer              | Path                                                                     |
| ------------------ | ------------------------------------------------------------------------ |
| Config             | `apps/ai-api/src/config/app-config.service.ts` (`loadCustomerIntake`)    |
| Bootstrap          | `apps/ai-api/src/intake/intake-bootstrap.service.ts`                     |
| SF contact resolve | `salesforce-case-write.gateway.ts` → `resolvePrimaryContactForAccount`   |
| BFF                | `apps/react-chat-window/app/api/intake/session/bootstrap/route.ts`       |
| Client             | `apps/react-chat-window/lib/intake-client.ts` → `bootstrapIntakeSession` |
