# Reference Patterns

## Trailhead Agent Script Recipes

Adopt:

- Recipe-style documentation with overview, flow, key concepts, setup, examples, and testing.
- Mermaid diagrams for agent flow and workflow reasoning.
- Small focused examples that teach one concept and stay deployable.
- Clear action definitions with explicit inputs, outputs, targets, and planner-visible fields.
- Validation checklists for agent structure, action bindings, variables, transitions, and prompt template actions.

## Aquiva Labs My Org Butler

Adopt:

- Agentforce metadata organized around topics, actions, prompt templates, permission sets, scripts, and evals.
- A real Agentforce testing split: Testing Center for topic/action assertions and REST multi-turn tests for real session behavior.
- Deployment notes for active agents, planner cache, prompt template versions, and schema-only metadata changes.
- Scratch org setup scripts, sample data, permission assignment, and manual setup runbooks.
- Actions that keep Salesforce-specific work in Apex and agent reasoning in Agentforce.

## Sentry

Adopt:

- Clear ownership boundaries for modules and packages.
- Tests that encode edge cases, corrupt data, and integration assumptions.
- Fixture-heavy testing for behavior that depends on external systems or configuration.
- CODEOWNERS-style thinking before the repo grows: each major surface needs a clear owner and review lens.

## Warden

Adopt:

- Scoped agents and skills with narrow descriptions, minimal tools, and explicit output formats.
- YAML evals with readable behavior fields such as `given`, `should_find`, and `should_not_find`.
- Strict schema validation for configuration and eval files.
- Separation between execution and judgment: runners collect outputs, judges grade them.
- AI telemetry discipline using `gen_ai.*` spans, token usage, cost metrics, and no-op safe instrumentation.
