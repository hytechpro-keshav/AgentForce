# Enable Intake Skip Email Verification

Bypass Salesforce OTP email verification so the landing/intake chatbot can test AI → Case create immediately.

Read `.agents/skills/intake-skip-email-verification/SKILL.md` first. For landing/chat architecture, also read `ablypro-landing-intake-chat/SKILL.md`.

## Quick enable (production)

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

## Quick disable (restore OTP)

```bash
railway variable set CUSTOMER_INTAKE_SKIP_EMAIL_VERIFICATION=false \
  --service ai-api --environment production --skip-deploys
railway variable set CUSTOMER_INTAKE_SKIP_EMAIL_VERIFICATION=false \
  --service react-chat-window --environment production --skip-deploys
SERVICE=all ./scripts/deploy/railway-quick-deploy.sh
```

## Verify

- `GET /api/intake/config` → `bootstrapAvailable: true`
- Open `/landing`, chat bubble → skips email, shows devices
- Playwright: `e2e/landing-page.spec.ts --grep "floating chat"`

$ARGUMENTS
