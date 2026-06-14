# Create Agentforce Action

Scaffold a new Agentforce action following the pattern in `.github/prompts/create-agentforce-action.prompt.md`.

## Steps

1. **Read context** — review `.github/instructions/salesforce-agentforce.instructions.md` for current standards.

2. **Gather requirements** — ask for:
   - Action name (PascalCase, e.g. `GetCaseHistory`)
   - Purpose / what it returns
   - Input parameters and types
   - Salesforce objects it queries or modifies

3. **Create files in `force-app/main/default/`**:
   - `genAiFunctions/<ActionName>.genAiFunction-meta.xml` — function metadata
   - `classes/<ActionName>Action.cls` — Apex invocable class
   - `classes/<ActionName>Action.cls-meta.xml`
   - `classes/<ActionName>ActionTest.cls` — test class with HTTP mock
   - `classes/<ActionName>ActionTest.cls-meta.xml`

4. **Action class requirements**:
   - `@InvocableMethod(label='...' description='...')`
   - Bulk-safe: accepts `List<Request>` returns `List<Result>`
   - Uses Named Credentials for callouts
   - All callout tests use `HttpCalloutMock`

5. **Verify**:
   - `sf apex run test --test-level RunLocalTests --wait 30 --result-format human`
   - `sf project deploy validate --source-dir force-app/main/default/classes/<ActionName>*`
