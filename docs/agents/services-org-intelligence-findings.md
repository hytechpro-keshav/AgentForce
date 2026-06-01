# Services Org Intelligence Agent

Salesforce runtime name: `Services_Org_Intelligence_Showcase_Agent_new`

## Executive Summary

Services Org Intelligence Agent was built to help services leaders move from
manual project inspection to faster, more consistent delivery-health review.
Instead of opening multiple Certinia PSA records and dashboards to understand
schedule pressure, budget risk, staffing gaps, and project status, the agent
brings those signals into one governed Agentforce experience.

The result is a read-only decision-support layer that helps services leaders
identify which projects need attention, why delivery health is trending a
certain way, and what operational next steps should be considered.

## Why We Built This Agent

Services-delivery risk is usually spread across multiple Certinia PSA objects
and signals. A services leader may need to review milestones, tasks,
assignments, resource requests, timecards, budget status, completion, and
project dates before deciding where intervention is needed.

That creates three practical problems:

- too much manual effort to review project health consistently
- delayed visibility into schedule, budget, and staffing risk
- inconsistent escalation and prioritization across the services portfolio

Services Org Intelligence Agent was built to close that gap with a governed AI
workflow that stays aligned to Salesforce security, Certinia PSA data access,
and read-only operational boundaries.

## What The Agent Does

The current agent experience combines two connected workflows:

- Project Directory: shows visible Certinia PSA projects in readable blocks so
  a services leader can quickly find and choose a project to inspect.
- Project Health Brief: generates a concise delivery-health summary for one
  selected project, including the project status, risk drivers, signals
  reviewed, confidence, and next best actions.

The design is intentionally read-only. The agent recommends actions, but it
does not create, update, rebaseline, approve, reject, staff, or otherwise
mutate PSA records.

## Core Benefits For Services Leaders

- Faster project triage: the agent reduces the time needed to understand which
  projects need attention.
- Better leadership visibility: project-health summaries make it easier to see
  schedule, budget, and staffing pressure without manual record-by-record
  inspection.
- More consistent project reviews: leaders get the same structured sections for
  overall health, status snapshot, rationale, reviewed signals, and next best
  actions.
- Better meeting preparation: the brief gives leaders a compact, executive-safe
  view before project reviews, delivery checkpoints, or escalation calls.
- Safer AI support: services leaders get recommendations without giving the
  model permission to alter projects or operational data.

## Core Benefits For The Company

- Earlier detection of delivery issues before they become customer-facing
  escalations.
- More consistent services governance across project reviews.
- Better resource-allocation decisions because staffing and schedule pressure
  become easier to spot.
- Reduced management overhead for routine project-health analysis.
- Safer operational adoption because the workflow is read-only and grounded in
  controlled PSA facts.
- A reusable architecture for future services, support, finance, and
  cross-functional operations intelligence use cases.

## Core Benefits For End Customers

- Healthier delivery outcomes because risks can be identified earlier.
- Fewer surprises in project execution when schedule, budget, or staffing
  issues are surfaced sooner.
- Better customer communication because services leaders and delivery teams can
  act on clearer project-health signals.
- Stronger confidence that delivery issues are being reviewed systematically,
  not only after they become visible problems.

## Why A Custom Agent Was Needed

This solution was not built because Salesforce lacks service AI. It was built
because the business needed a very specific services-delivery intelligence
workflow.

The custom agent gives us capabilities that are tightly aligned to our
operating model:

- a governed employee-facing workflow for browsing projects and drilling into
  one project-health summary
- direct alignment to Certinia PSA objects and delivery signals, not only
  generic case or ticket workflows
- deterministic scoring for schedule, budget, staffing, overall health, and
  confidence before the model writes the narrative
- a secure callout pattern where Apex gathers approved aggregate PSA facts and
  the backend returns an executive-safe summary
- a read-only operating model that supports adoption without introducing record
  mutation risk

In short, the custom agent is tailored to services-delivery leadership, our
Certinia PSA data model, and our governance boundaries in a way that a generic
out-of-the-box service agent cannot guarantee.

## Salesforce Market Comparison

As of the Salesforce public pages reviewed on 28 May 2026, Salesforce offers
several adjacent capabilities, but none of them is a drop-in replacement for
this exact workflow.

### What Salesforce Already Offers

**Agentforce Service**

Salesforce positions Agentforce Service as a unified service platform that
brings AI agents, human expertise, and trusted data together for customer
service, contact center, field service, and broader support experiences. Its
public service page highlights routine-task automation, AI-powered insights,
and proactive support.

**Customer Service And Service Cloud Capabilities**

Salesforce publicly emphasizes instant resolutions, case efficiency,
AI-powered insights, and early issue detection for customer-service teams.
This is strong for customer support operations and omni-channel service
delivery.

**Agentforce IT Service**

Salesforce positions Agentforce IT Service as a conversational, ticket-reducing
support model for employees and IT teams. Its public announcement focuses on
incident management, IT-service automation, AI-assisted troubleshooting,
connectors, and operational efficiency.

### Where Our Agent Is Different

Services Org Intelligence Agent is focused on a narrower but more operationally
specific problem: helping services leaders understand the health of Certinia PSA
projects and decide where delivery intervention may be needed.

Compared with Salesforce's public offerings, our custom agent is differentiated
by:

- a project-directory and project-health workflow built specifically for
  services-delivery review
- deterministic delivery-health scoring before AI explanation, rather than a
  purely conversational agent layer
- direct use of Certinia PSA delivery signals such as milestones, assignments,
  resource requests, budgets, and timecard-related indicators
- output tailored to project-health review instead of customer case resolution
  or IT ticket handling
- explicit read-only boundaries that keep the agent in analysis mode rather
  than operational record mutation

### Practical Conclusion On The Comparison

Salesforce does have similar and in some areas broader capabilities. It is
especially strong in customer service automation, omni-channel support,
employee/IT service workflows, and AI-assisted service operations.

However, the current public Salesforce offerings do not present the exact same
governed workflow that we needed: a services-leader experience for browsing
visible Certinia PSA projects, selecting one project, and receiving a
deterministic, explainable delivery-health brief grounded in services-delivery
signals.

That is why the custom Services Org Intelligence Agent is justified. It is not
better than Salesforce in every category. It is a better fit for this specific
services-delivery use case.

## Strategic Value

Services Org Intelligence Agent should be viewed as more than an AI summary
tool. It is a services-governance capability that helps the organization scale
delivery oversight, improve project-review quality, and respond faster to
emerging delivery risk.

It creates value at three levels:

- for services leaders: better visibility and faster project triage
- for the business: stronger delivery governance and earlier intervention
- for customers: more proactive and better-managed project delivery

## External References Reviewed

- Salesforce Product Page: Agentforce Service
  https://www.salesforce.com/service/
- Salesforce News: Agentforce IT Service
  https://www.salesforce.com/news/stories/agentforce-it-service-announcement/
