# Agent 4 — The Parts & Logistics Agent

_The supply chain specialist who answers: "Do we have the part, where is it, and when will it arrive?"_

Once a case is sorted, the customer story is clear, and the approved fix is known, the next question is practical and urgent: **can we actually get the parts needed to complete the repair — and how soon?** That's Agent 4. It checks live inventory, picks the right warehouse, estimates realistic delivery times, and builds a clear fulfillment plan — so your team never promises a fix they can't deliver.

---

## What it does (in one line)

**It checks whether every suggested part is available, plans how to get it to the job site, estimates when it will arrive, and flags anything that needs approval — so scheduling and service happen with real parts reality, not wishful thinking.**

---

## Scope — what this agent owns (and what it does not)

**Agent 4 owns parts and logistics planning only.**

| In scope                                             | Out of scope                                        |
| ---------------------------------------------------- | --------------------------------------------------- |
| Checking whether suggested parts are in stock        | Scheduling a technician                             |
| Confirming parts fit the customer's equipment        | Writing replies to the customer                     |
| Choosing the best warehouse to fulfill from          | Making final approval decisions                     |
| Estimating delivery time (including transfers)       | Placing orders or moving inventory without approval |
| Planning warehouse transfers when stock is elsewhere | Changing anything in your systems on its own        |
| Flagging backorders when nothing is available        | Promising exact delivery dates to the customer      |
| Identifying when human approval is needed            | Deciding warranty or policy outcomes                |

Agent 4 **reads inventory and builds a plan**. It does not dispatch technicians, send customer messages, or commit orders. It gives the rest of the team an honest picture of parts readiness so they can schedule and act wisely.

---

## Topic — what this agent is about

**Parts availability, fulfillment planning, and delivery timing.**

Every case that needs a physical repair eventually comes down to parts. Agent 4 answers the questions your best logistics coordinator would ask before anyone picks a service date:

- Do we have the part the fix calls for?
- Does it actually fit this customer's equipment?
- Which warehouse should fulfill this job — the one closest to where service is needed?
- Is the part already there, or does it need to move from another location?
- How long until the part is ready for the technician — hours, days, or longer?
- If we're out of stock everywhere, what is the recovery path?
- Does this situation need a manager to approve before we proceed?

Triage tells you _how urgent_ the case is. Customer history tells you _who you're dealing with_. Knowledge tells you _what the fix looks like_. Agent 4 tells you _whether the parts side of that fix is actually doable — and on what timeline_.

---

## Why it matters

- **No more "we'll figure out parts later."** Your team knows upfront whether the repair can happen on schedule.
- **Remote stock is not fake availability.** If a part sits in a warehouse across the country, Agent 4 plans the transfer — it doesn't pretend it's already on hand.
- **Customers get realistic timelines.** Delivery estimates account for processing, warehouse moves, and shipping — not just "in stock somewhere."
- **Urgent cases get priority treatment.** Critical and premium customers can see faster fulfillment when your operations support it.
- **Out of stock is handled, not hidden.** When nothing is available, the team gets a clear backorder path instead of discovering the gap on the day of service.
- **Approvals happen before commitments.** Cross-region transfers and sensitive moves are flagged early — before anyone schedules a technician or promises a date.

---

## Steps it executes (the simple version)

Think of Agent 4 as a fast, careful logistics coordinator who always checks the warehouse before making a promise:

1. **Receives the enriched case** — picks up where Agents 1, 2, and 3 left off, with priority, customer context, and the recommended fix already in place.
2. **Identifies the parts needed** — pulls the suggested parts from the approved repair guidance.
3. **Checks compatibility** — confirms each part actually fits the customer's equipment.
4. **Finds the right fulfillment location** — selects the warehouse nearest where service will happen, not just wherever stock happens to sit.
5. **Checks live inventory** — looks at real stock levels at that location and across your network.
6. **Builds the fulfillment path** — decides whether the part is ready on site, needs a warehouse transfer, or requires a backorder.
7. **Calculates delivery timing** — estimates a realistic arrival window, including processing, transfers, and last-mile delivery.
8. **Applies urgency rules** — adjusts timing for critical cases and premium service levels where your operations allow faster handling.
9. **Flags exceptions and approvals** — highlights low stock, cross-region moves, incompatible parts, or situations that need a manager's sign-off.
10. **Packages everything for the team** — delivers a clear parts fulfillment plan and passes the case to the next agent.

The whole process runs automatically in seconds — no one has to call the warehouse, open a spreadsheet, or guess whether a part can arrive in time.

---

## Output — what Agent 4 produces

For every case, Agent 4 delivers a **Parts Fulfillment Plan** — a ready-to-use snapshot the rest of the AI team (and your people) can rely on:

| Output                     | What it tells you                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Overall readiness**      | Whether parts are ready, partially ready, blocked, or unknown — at a glance.                         |
| **Per-part status**        | For each part: available, needs transfer, backordered, incompatible, or missing from catalog.        |
| **Fulfillment location**   | Which warehouse will actually supply the job — the one closest to where service is needed.           |
| **Source location**        | Where stock currently sits, if it needs to move from another warehouse first.                        |
| **Delivery estimate**      | A realistic time window for when parts will be ready — not an optimistic guess.                      |
| **Delivery breakdown**     | The steps behind the estimate: processing, warehouse transfer, and final delivery.                   |
| **Exception type**         | What kind of issue applies — none, transfer needed, backorder, incompatible part, or data gap.       |
| **Approval needed**        | Whether a manager must sign off before the plan moves forward (for example, cross-region transfers). |
| **Low-stock warning**      | When inventory is technically available but running thin on high-value or hard-to-replace parts.     |
| **Plain-language summary** | A short, readable explanation of the parts situation anyone on the team can understand.              |

That's the logistics picture. Clear, honest, and ready for the agents that schedule service, run final approval, and draft the customer response.

---

## Built-in trust & safety

- **Live inventory, not memory.** Agent 4 checks your current stock records — it doesn't assume parts are available because they were last week.
- **Honest about gaps.** If a part is out of stock, incompatible, or missing from your catalog, it says so clearly instead of smoothing over the problem.
- **Read-only by default.** It plans first. Actual orders, transfers, and reservations happen only after the right approvals — not automatically on its own.
- **No false shortcuts.** Stock in a distant warehouse is treated as a transfer plan, not instant availability.
- **Priority-aware, not reckless.** Urgent cases can get faster handling where your operations support it — but Agent 4 never skips required approvals.
- **A specialist, not a decision-maker.** Agent 4 describes the parts situation and the plan. It does not schedule technicians, talk to customers, or approve spend — those decisions belong to later agents and, where needed, to people.

---

## Where it fits in the bigger picture

Agent 4 is **step four of a connected AI service team.**

```
Agent 1 sorts & prioritizes  →  Agent 2 builds customer context  →  Agent 3 finds the fix  →  Agent 4 plans parts & delivery  →  …
```

Once Agents 1 through 3 have prepared the case, Agent 4 enriches it with a realistic parts and logistics plan. From there, specialized agents take over — scheduling the right technician at the right time, running a final compliance and approval check, drafting the customer response, and logging insights for the business.

In short: **Agent 4 turns "we think we can fix it" into "here's exactly how the parts get there — and when."**

---

## One-line pitch

> _"Agent 4 instantly checks live inventory, plans the best fulfillment path, and estimates realistic delivery times — so every repair starts with parts you can actually count on."_
