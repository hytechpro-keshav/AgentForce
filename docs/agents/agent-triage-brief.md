# The Triage Agent

_The front door of your AI service team — case and customer, together._

When a customer issue comes in, Triage reads the **case** and the **full customer context** before anything else runs. It decides how urgent the issue really is, writes a plain-English summary that covers both the problem and who is affected, and hands the workflow to Knowledge and the rest of the team with one shared picture.

---

## What it does (in one line)

**It reads every incoming case and the customer behind it, sets priority using that full context, writes a complete summary, and recommends the next step — instantly, 24/7.**

---

## What it produces

For every case, Triage delivers:

1. **Priority** — Low, Normal, High, or Critical (informed by case text **and** customer stakes when evidence exists).
2. **Complete summary** — plain English covering the issue **and** customer context (tier, SLA, repeat issues, risk).
3. **Recommended next step** — what should happen next to move the case forward.
4. **Customer Context Package** — structured findings (tier, SLA, warranty, equipment, repeat incidents, business risk) for downstream agents.

---

## How it works

1. **Read the case** — subject, description, reported urgency from Salesforce.
2. **Read the customer** — account tier, SLA, warranty, assets, history, open incidents, escalation patterns (when an account is linked).
3. **Think** — synthesize customer risk, then run context-informed triage (priority + unified summary).
4. **Hand off** — Knowledge, Parts, Scheduling, and Guardrail all read the same `customerContext` channel Triage assembled.

There is **no separate Customer History stage** in the operator UI — that work lives inside Triage.

---

## Built-in trust & safety

- **Privacy first** — sensitive details are redacted; customer signals passed to the model are sanitized flat facts only.
- **Prompt-injection hardening** — authoritative customer context is fenced with a per-request token; case subject/description are treated as untrusted.
- **Degrade-safe** — missing account or failed reads still run triage on case text; priority falls back to reported urgency when evidence is absent.
- **Read-only to Salesforce** for customer enrichment; Case write-back remains approval-gated downstream.
- **Fully transparent** — execution traces record triage and customer-read sub-steps.

---

## Where it fits

Triage is **Node 1** of the connected AI service team. Downstream nodes keep their numbers (Knowledge = Node 3, Parts = Node 4, etc.):

```
Triage (case + customer) → Knowledge → Parts & Logistics → Scheduling → Compliance & Guardrail → …
```

---

## One-line pitch

> _"Triage reads the case and the full customer story, sets priority with real context, and gives every next agent the same complete picture — instantly."_

---

## Legacy briefs

- Former Agent 1 brief: `agent-1-routing-triage-brief.md` (superseded)
- Former Agent 2 brief: `agent-2-customer-history-brief.md` (superseded)

Implementation plan: `docs/orchestrator/triage-customer-history-merge-plan.md`.
