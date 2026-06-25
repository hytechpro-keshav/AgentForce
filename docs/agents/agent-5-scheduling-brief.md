# Agent 5 — The Scheduling Agent

_The dispatcher who matches the right technician to the right job — at the right time._

Once a case is sorted, the customer story is clear, the fix is known, and parts are planned, the next question is the one customers care about most: **when can someone actually come out and fix this?** That's Agent 5. It finds the best available technician for the job, checks their skills and calendar, waits for parts if needed, and proposes the earliest realistic service window — so your team never books a visit they can't actually deliver.

---

## What it does (in one line)

**It finds the best technician for the job, checks when they are truly available, respects when parts will actually arrive, and proposes the earliest honest service window — so every appointment is realistic, not wishful.**

---

## Scope — what this agent owns (and what it does not)

**Agent 5 owns service scheduling and technician matching only.**

| In scope                                        | Out of scope                                |
| ----------------------------------------------- | ------------------------------------------- |
| Finding the best technician for the repair type | Checking inventory or ordering parts        |
| Matching skills to the job and equipment        | Searching the knowledge base for fixes      |
| Checking technician availability and calendar   | Building the customer history picture       |
| Respecting parts delivery timing before booking | Writing replies to the customer             |
| Proposing a realistic service window            | Making final approval decisions on its own  |
| Ranking backup technician options               | Changing customer or case records freely    |
| Booking the visit after approval is granted     | Promising dates before the plan is approved |

Agent 5 **plans and proposes the visit**. It does not talk to customers, order parts, or skip the approval step. It gives the rest of the team a clear, honest scheduling recommendation they can trust.

---

## Topic — what this agent is about

**Technician matching, availability, and realistic service timing.**

Every field repair eventually needs a person on site. Agent 5 answers the questions your best dispatcher would ask before locking in a date:

- Who is the best technician for this type of repair?
- Do they have the right skills for this equipment?
- Are they in the right area to serve this customer?
- When are they actually free — not just on paper, but on their real calendar?
- Have the parts arrived yet, or do we need to wait before we can schedule?
- What is the earliest honest window we can offer without overpromising?
- Does this situation need extra attention — after hours, SLA risk, or a special approval?

Triage tells you _how urgent_ the case is. Customer history tells you _who you're dealing with_. Knowledge tells you _what the fix looks like_. Parts tells you _when the materials will be ready_. Agent 5 tells you _who should go, and when they can realistically get there_.

---

## Why it matters

- **No more empty calendar slots.** A free technician doesn't help if the parts aren't on site yet — Agent 5 waits for parts reality before proposing a date.
- **The right person for the job.** Repairs are matched to technicians with the right skills, not just whoever is available.
- **Local, human-readable windows.** Service times are shown in the customer's local time — "Thursday 9–11 AM," not a confusing internal timestamp.
- **Honest about uncertainty.** When parts are still in transit, the plan is marked as provisional — the team knows the date depends on delivery, not a firm promise.
- **Calendar conflicts are caught early.** If a technician is already booked, Agent 5 finds the next open slot instead of double-booking.
- **Urgent customers get appropriate urgency.** Priority and service-level agreements influence how quickly a window is proposed — without breaking the rules.
- **Booking happens only after approval.** The visit is reserved in your system only once the right people have signed off — not before.

---

## Steps it executes (the simple version)

Think of Agent 5 as a fast, careful dispatcher who always checks parts and calendars before confirming a date:

1. **Receives the fully prepared case** — picks up where Agents 1 through 4 left off, with priority, customer context, the approved fix, and the parts plan already in place.
2. **Understands what kind of visit is needed** — uses the repair type, equipment involved, and estimated job duration to know what to look for.
3. **Checks parts readiness** — confirms whether parts are already on site, still in transit, or blocked — because service cannot start before materials arrive.
4. **Finds qualified technicians** — identifies who has the right skills for this repair and serves the customer's area.
5. **Ranks the best options** — scores candidates by skill fit, location, availability, and overall suitability for the job.
6. **Checks real availability** — reviews working hours, existing appointments, and time off so proposed slots are genuinely open.
7. **Calculates the earliest honest start** — the service window cannot begin before parts arrive, the technician is free, and any service-level target is respected.
8. **Proposes a service window** — delivers a clear time range in local time, with a plain explanation of why it cannot be earlier if something is holding it up.
9. **Flags special situations** — highlights after-hours visits, SLA risks, cross-region assignments, or other cases that may need extra approval.
10. **Packages everything for the team** — delivers a structured scheduling recommendation and passes the case to the approval step.
11. **Books the visit after approval** — once the plan is approved, creates the service appointment in your system so dispatch and the technician see it on their calendar.

The whole process runs automatically in seconds — no one has to juggle spreadsheets, call dispatch, or guess whether a date is actually doable.

---

## Output — what Agent 5 produces

For every case, Agent 5 delivers a **Service Scheduling Plan** — a ready-to-use snapshot the rest of the AI team (and your people) can rely on:

| Output                      | What it tells you                                                                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Scheduling readiness**    | Whether a visit can be booked now, is waiting on parts, should be deferred, or cannot be scheduled yet.                                 |
| **Recommended technician**  | The top-ranked person for the job — identified safely without exposing private details.                                                 |
| **Ranked alternatives**     | Backup technician options if the first choice becomes unavailable.                                                                      |
| **Proposed service window** | The suggested date and time range for the visit, shown in local time.                                                                   |
| **Why this window**         | A plain explanation of what set the earliest possible start — parts arrival, technician availability, or urgency rules.                 |
| **Parts dependency**        | Whether the proposed date depends on parts still being in transit.                                                                      |
| **Job duration estimate**   | How long the visit is expected to take, based on the type of repair.                                                                    |
| **Confidence level**        | How solid the proposed window is — firm, provisional, or low confidence when information is incomplete.                                 |
| **Approval signals**        | Whether the situation needs extra human review before booking — for example, after-hours or high-risk timing.                           |
| **Appointment status**      | Whether a visit is only proposed, or has been booked after approval.                                                                    |
| **Plain-language summary**  | A short, readable explanation anyone on the team can understand — for example, "Technician A2 · Thursday 9–11 AM (after parts arrive)." |

That's the scheduling picture. Clear, honest, and ready for the agents that run final approval, draft the customer response, and log insights for the business.

---

## Built-in trust & safety

- **Parts before promises.** Agent 5 will not propose a confident service date before the parts plan says materials can be on site — a free technician slot is not enough on its own.
- **Skills before assignment.** The recommended technician is matched to the repair type — not just whoever has an open calendar.
- **Honest when blocked.** If parts are backordered or no qualified technician is available, it says so clearly instead of inventing a date.
- **Privacy aware.** Technician recommendations use safe references — not full personal names scattered across every screen.
- **Approval before booking.** A proposed window is not the same as a confirmed appointment. Booking happens only after the right approval step.
- **Fresh check at booking time.** Before the visit is actually created, Agent 5 re-checks parts and availability so nothing changed between planning and confirmation.
- **A specialist, not a decision-maker.** Agent 5 recommends who and when. It does not approve spend, talk to customers, or override policy — those decisions belong to later agents and, where needed, to people.

---

## Where it fits in the bigger picture

Agent 5 is **step five of a connected AI service team.**

```
Agent 1 sorts & prioritizes  →  Agent 2 builds customer context  →  Agent 3 finds the fix  →  Agent 4 plans parts & delivery  →  Agent 5 schedules the visit  →  …
```

Once Agents 1 through 4 have prepared the case, Agent 5 enriches it with a realistic technician match and service window. From there, specialized agents take over — running a final compliance and approval check, drafting the customer response, and logging insights for the business.

In short: **Agent 5 turns "we have a plan" into "here's who is coming, and when — for real."**

---

## One-line pitch

> _"Agent 5 instantly matches the right technician to every job and proposes the earliest honest service window — so every visit is scheduled with parts, skills, and availability in sync, not guesswork."_
