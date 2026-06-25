# Agent 6 — The Compliance & Guardrail Agent

_The safety officer who makes sure nothing moves forward until it's right._

By the time a case reaches this stage, five other agents have already done their work — the issue is sorted, the customer is understood, the fix is known, the parts are planned, and a technician is scheduled. Agent 6 is the **final checkpoint before anything is acted on**. It looks at the full picture, applies your company's rules, and decides: proceed automatically, pause for a manager's sign-off, reject the plan, or escalate to a supervisor.

This is the **only agent that can stop and wait for a person**. Every other agent runs straight through. Agent 6 exists so your business stays in control — especially when the stakes are high.

---

## What it does (in one line)

**It reviews everything the AI team has planned for a case, checks it against your policies and risk rules, and decides whether to auto-approve, hold for human sign-off, reject, or escalate — before any customer message is sent or any action is taken.**

---

## Scope — what this agent owns (and what it does not)

**Agent 6 owns compliance review and the approval gate only.**

| In scope                                                  | Out of scope                          |
| --------------------------------------------------------- | ------------------------------------- |
| Reviewing the full case plan from Agents 1–5              | Sorting or prioritizing new cases     |
| Checking customer entitlement, warranty, and account risk | Finding troubleshooting guidance      |
| Flagging safety concerns from approved knowledge          | Checking inventory or planning parts  |
| Weighing parts and scheduling approval flags              | Booking technicians                   |
| Scoring overall risk and deciding the outcome             | Writing replies to the customer       |
| Sending approval requests to the right person             | Making operational changes on its own |
| Waiting for human approve/reject before moving on         | Logging long-term business insights   |

Agent 6 **judges and gates**. It does not fix problems, schedule visits, or talk to customers. It makes sure the plan is safe, compliant, and appropriate — and gets a human involved when your rules say one is needed.

---

## Topic — what this agent is about

**Compliance, policy, risk, and human approval.**

Every case that needs action eventually needs a green light. Agent 6 answers the questions your best operations manager would ask before signing off:

- Is this customer actually entitled to what we're about to do?
- Are there safety warnings we must respect before work begins?
- Do the parts plan or scheduling need manager approval?
- Is this a strategic account, repeat issue, or high-risk situation?
- Is the overall risk low enough to proceed on its own — or does someone need to review it?
- Should this be rejected outright, or escalated to a supervisor?

Agents 1 through 5 tell you _what to do_. Agent 6 tells you _whether you're allowed to do it — and who needs to say yes_.

---

## Why it matters

- **Nothing slips through unchecked.** Every case gets a structured compliance review before action — not just the ones someone remembers to flag.
- **Routine cases move fast.** Low-risk situations are auto-approved instantly — no unnecessary delays or inbox clutter.
- **High-risk cases get human eyes.** When parts transfers, after-hours scheduling, safety alerts, or premium accounts are involved, the right approver is notified automatically.
- **Your rules, applied consistently.** The same policy checks run every time — no "forgot to ask the manager" moments.
- **Clear reasons, not mystery holds.** When approval is needed, the approver sees _why_ — tied to specific policy triggers, not a vague "please review."
- **The business stays in control.** A human can approve, reject, or a supervisor can take over — before anything is committed to the customer or your systems.
- **Safety comes first.** Critical safety flags from your knowledge base can trigger immediate escalation — before any risky work is scheduled.

---

## Steps it executes (the simple version)

Think of Agent 6 as a thorough compliance reviewer who never skips a checklist:

1. **Receives the complete case package** — picks up where Agents 1 through 5 left off, with priority, customer context, approved guidance, parts plan, and scheduling proposal all in place.
2. **Reviews urgency and customer risk** — considers how critical the case is, who the customer is, their service level, warranty status, and whether this is a repeat or strategic account.
3. **Checks knowledge and safety signals** — looks for safety warnings or policy flags from the approved fix guidance.
4. **Reviews the parts plan** — confirms whether parts are ready, need approval (for example, cross-region transfers), or are unavailable.
5. **Reviews the scheduling proposal** — checks for flags like after-hours visits, SLA pressure, or territory exceptions.
6. **Applies your policy rules** — runs everything through your company's compliance and risk rules to produce a clear outcome.
7. **Calculates overall risk** — combines all signals into a simple risk level so everyone understands the seriousness at a glance.
8. **Decides the outcome** — one of four paths:
   - **Auto-approve** — low risk; the case can proceed immediately.
   - **Require human approval** — moderate risk; pause and notify the right approver.
   - **Reject** — the plan cannot proceed as proposed (for example, entitlement mismatch).
   - **Escalate** — high risk or safety-critical; route to a supervisor path.
9. **Sends approval when needed** — if a human sign-off is required, the request goes to the account manager's email or your Salesforce approval process — not buried in a dashboard nobody checks.
10. **Waits for the decision** — the workflow pauses until the approver responds. Once approved, the case moves to drafting the customer response and completing the work. If rejected or escalated, the case follows the appropriate path.

The whole review runs in seconds for auto-approved cases. When human approval is needed, the workflow waits patiently until someone decides — then picks up exactly where it left off.

---

## Output — what Agent 6 produces

For every case, Agent 6 delivers a **Compliance & Guardrail Decision** — a clear verdict the rest of the team (and your approvers) can act on:

| Output                     | What it tells you                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Decision outcome**       | Auto-approved, waiting for approval, rejected, or escalated — the bottom line.                             |
| **Risk score**             | A simple 0–100 score showing how much risk this case carries overall.                                      |
| **Risk level**             | Low, medium, high, or critical — easy to understand at a glance.                                           |
| **Policy rules triggered** | Which specific company rules fired — so the decision is auditable and explainable.                         |
| **Approval reasons**       | Plain-language list of why a human sign-off is needed (when applicable).                                   |
| **What was reviewed**      | Which parts of the case plan contributed to the decision — triage, customer, knowledge, parts, scheduling. |
| **Approval routing**       | Where the approval request was sent and when — email, Salesforce, or other channel.                        |
| **Final verdict summary**  | A short headline and summary your team can read without digging through details.                           |

That's the gate decision. Clear, policy-backed, and ready for the agents that draft the customer response and log business insights — or for a human to approve, reject, or take over.

---

## Built-in trust & safety

- **Rules, not guesswork.** Agent 6 follows your defined policy rules — it does not improvise compliance decisions.
- **Consistent every time.** The same case inputs produce the same review outcome — no mood swings or forgotten checks.
- **Human in the loop when it matters.** Only Agent 6 can pause the workflow and wait for a real person — and only when your rules say it's needed.
- **Approvals happen where work gets done.** Sign-off requests go to email or Salesforce — the tools your managers already use — not a separate screen they might miss.
- **No action without approval.** Parts reservations, scheduling commits, and customer-facing steps wait until Agent 6 clears the case (or a human approves).
- **Stop and take over anytime.** Operators can halt the AI workflow and take manual control if the situation needs a human touch.
- **Timeout protection.** If no one responds to an approval request in time, the case can be escalated automatically — so nothing sits forgotten in someone's inbox.
- **A gatekeeper, not a doer.** Agent 6 reviews and decides. It does not schedule, order parts, write to customers, or change records on its own.

---

## Where it fits in the bigger picture

Agent 6 is **step six of a connected AI service team — and the last checkpoint before action.**

```
Agent 1 sorts & prioritizes  →  Agent 2 builds customer context  →  Agent 3 finds the fix  →  Agent 4 plans parts & delivery  →  Agent 5 schedules the technician  →  Agent 6 reviews & approves  →  …
```

Once Agents 1 through 5 have built the full service plan, Agent 6 runs the compliance and risk review. If the case is cleared — automatically or by a human — the workflow continues to Agent 7 (drafting the customer response and work notes) and Agent 8 (logging insights for the business).

In short: **Agent 6 is the guardrail that keeps your AI service team safe, compliant, and accountable — so automation moves fast on routine cases and slows down exactly when your business needs a human in the loop.**

---

## One-line pitch

> _"Agent 6 reviews every case against your policies and risk rules — auto-approving what's safe and routing the rest to the right person for sign-off — before anything is promised or acted on."_
