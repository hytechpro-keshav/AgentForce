/**
 * Node 6 — Phase 6b+ Salesforce Approval submit executor.
 *
 * Called by the NestJS orchestrator (via {@link AgentforceGuardrailApprovalRest})
 * when the compliance guardrail holds a Case for Account Manager approval. It:
 *   1. Stamps the Orchestrator Verdict (headline/summary/steps/highlights +
 *      console deep link), the workflow id, the workflow-scoped resume token,
 *      and `AI_Guardrail_Status__c = pending_approval` on the Case.
 *   2. Submits the native Case Approval Process so the approver acts in
 *      Salesforce — not in the read-only React console.
 *
 * The class is:
 *   - with sharing + FLS/CRUD checked (Schema.sObjectType.Case.fields.*),
 *   - idempotent on the workflow id: a resubmit while an approval is already
 *     pending returns `alreadyPending` with the existing ProcessInstance id
 *     and never double-submits,
 *   - degrade-safe: it NEVER throws — a failure returns `degraded = true` so
 *     the NestJS graph still reaches `interrupt()` and the operator can fall
 *     back to a manual resume.
 *
 * The request/response JSON mirrors the submit contract in
 * `apps/ai-api/src/orchestrator/dto/guardrail.ts`
 * (`GuardrailApprovalSubmitCommand` / `GuardrailApprovalSubmitResult`).
 */
public with sharing class AgentforceGuardrailApprovalService {
  private static final String STATUS_PENDING = 'pending_approval';
  private static final String PROCESS_PENDING = 'Pending';

  /**
   * Stamps the Case and submits the Approval Process for one held workflow.
   * Never throws — record-level failures degrade the result.
   */
  public static SubmitResult submit(SubmitRequest request) {
    SubmitResult result = new SubmitResult();
    result.submitted = false;
    result.degraded = false;

    if (
      request == null ||
      String.isBlank(request.workflowId) ||
      String.isBlank(request.caseId) ||
      String.isBlank(request.resumeToken)
    ) {
      result.degraded = true;
      return result;
    }

    Id caseId;
    try {
      caseId = (Id) request.caseId;
    } catch (Exception badId) {
      result.degraded = true;
      return result;
    }

    if (!Schema.sObjectType.Case.fields.AI_Guardrail_Status__c.isUpdateable()) {
      // No FLS to stamp the guardrail context — degrade rather than submit a
      // half-populated approval the approver cannot understand.
      result.degraded = true;
      return result;
    }

    // ---- Idempotency: is an approval already pending for this Case? ----
    List<ProcessInstance> pending = [
      SELECT Id
      FROM ProcessInstance
      WHERE TargetObjectId = :caseId AND Status = :PROCESS_PENDING
      ORDER BY CreatedDate DESC
      LIMIT 1
    ];
    Boolean alreadyPending = !pending.isEmpty();

    // ---- Stamp the Case (verdict + token + status), best-effort per FLS ----
    try {
      stampCase(caseId, request);
    } catch (Exception stampError) {
      // A stamp failure should not block a still-valid submit, but it does
      // mean the approver may miss the verdict — flag degraded.
      result.degraded = true;
    }

    if (alreadyPending) {
      result.submitted = true;
      result.alreadyPending = true;
      result.processInstanceId = String.valueOf(pending[0].Id);
      return result;
    }

    // ---- Submit the Approval Process ----
    try {
      Approval.ProcessSubmitRequest submitReq = new Approval.ProcessSubmitRequest();
      submitReq.setObjectId(caseId);
      submitReq.setProcessDefinitionNameOrId(processName());
      submitReq.setSkipEntryCriteria(true);
      submitReq.setComments(buildSubmitComment(caseId, request));
      Approval.ProcessResult approvalResult = Approval.process(
        submitReq,
        false
      );
      if (approvalResult != null && approvalResult.isSuccess()) {
        result.submitted = true;
        result.processInstanceId = String.valueOf(
          approvalResult.getInstanceId()
        );
      } else {
        result.degraded = true;
      }
    } catch (Exception submitError) {
      result.degraded = true;
    }
    return result;
  }

  private static String processName() {
    // Configurable via NestJS, but the metadata developer name is fixed for
    // the deployed Approval Process.
    return 'Agentforce_Guardrail_Approval';
  }

  private static void stampCase(Id caseId, SubmitRequest request) {
    Case caseRow = new Case(Id = caseId);
    Schema.DescribeFieldResult statusFd = Case.AI_Guardrail_Status__c.getDescribe();
    if (statusFd.isUpdateable()) {
      caseRow.AI_Guardrail_Status__c = STATUS_PENDING;
    }
    setIfUpdateable(caseRow, 'AI_Triage_Workflow_Id__c', request.workflowId);
    setIfUpdateable(
      caseRow,
      'AI_Guardrail_Resume_Token__c',
      request.resumeToken
    );
    setIfUpdateable(
      caseRow,
      'AI_Orchestration_Console_URL__c',
      request.orchestrationConsoleUrl
    );
    if (request.verdict != null) {
      String summary = request.verdict.summary;
      String ownerName = resolveAccountOwnerName(caseId);
      if (String.isNotBlank(ownerName) && String.isNotBlank(summary)) {
        summary = enrichSummaryWithAccountOwner(summary, ownerName);
      }
      setIfUpdateable(
        caseRow,
        'AI_Orchestrator_Verdict_Headline__c',
        truncate(request.verdict.headline, 255)
      );
      setIfUpdateable(
        caseRow,
        'AI_Orchestrator_Verdict_Summary__c',
        truncate(summary, 32768)
      );
      setIfUpdateable(
        caseRow,
        'AI_Orchestrator_Verdict_Steps__c',
        truncate(joinLines(request.verdict.recommendedSteps), 4096)
      );
      setIfUpdateable(
        caseRow,
        'AI_Orchestrator_Verdict_Highlights__c',
        truncate(joinHighlights(request.verdict.highlights), 4096)
      );
    }
    update caseRow;
  }

  private static void setIfUpdateable(
    Case caseRow,
    String fieldName,
    String value
  ) {
    if (String.isBlank(value)) {
      return;
    }
    Schema.SObjectField field = Case.SObjectType.getDescribe()
      .fields.getMap()
      .get(fieldName);
    if (field != null && field.getDescribe().isUpdateable()) {
      caseRow.put(fieldName, value);
    }
  }

  private static String joinLines(List<String> lines) {
    if (lines == null || lines.isEmpty()) {
      return null;
    }
    List<String> numbered = new List<String>();
    for (Integer i = 0; i < lines.size(); i++) {
      if (String.isNotBlank(lines[i])) {
        numbered.add((i + 1) + '. ' + lines[i]);
      }
    }
    return numbered.isEmpty() ? null : String.join(numbered, '\n');
  }

  private static String joinHighlights(List<VerdictHighlight> highlights) {
    if (highlights == null || highlights.isEmpty()) {
      return null;
    }
    List<String> lines = new List<String>();
    for (VerdictHighlight highlight : highlights) {
      if (highlight != null && String.isNotBlank(highlight.label)) {
        lines.add(highlight.label + ': ' + highlight.value);
      }
    }
    return lines.isEmpty() ? null : String.join(lines, '\n');
  }

  private static String truncate(String value, Integer max) {
    if (value == null) {
      return null;
    }
    return value.length() > max ? value.substring(0, max) : value;
  }

  /**
   * Builds the Approval Process submitter comment from the executive summary,
   * optional console deep link, and workflow id. Degrade-safe when fields are
   * blank.
   */
  @TestVisible
  private static String buildSubmitComment(Id caseId, SubmitRequest request) {
    List<String> lines = new List<String>();
    if (request.verdict != null && String.isNotBlank(request.verdict.summary)) {
      String summary = request.verdict.summary;
      String ownerName = resolveAccountOwnerName(caseId);
      if (String.isNotBlank(ownerName)) {
        summary = enrichSummaryWithAccountOwner(summary, ownerName);
      }
      lines.add(summary);
    }
    if (request.approvalReasons != null && !request.approvalReasons.isEmpty()) {
      lines.add(
        'Policy signals: ' + String.join(request.approvalReasons, '; ')
      );
    }
    if (String.isNotBlank(request.orchestrationConsoleUrl)) {
      lines.add('Orchestration console: ' + request.orchestrationConsoleUrl);
    }
    lines.add(
      'Submitted by AI compliance guardrail (workflow ' +
        request.workflowId +
        ').'
    );
    return String.join(lines, '\n\n');
  }

  /**
   * Best-effort Account Owner name for approver-facing copy. Returns null when
   * the Account or Owner is absent — never throws.
   */
  @TestVisible
  private static String resolveAccountOwnerName(Id caseId) {
    try {
      List<Case> rows = [
        SELECT Account.Owner.Name
        FROM Case
        WHERE Id = :caseId
        LIMIT 1
      ];
      if (rows.isEmpty() || rows[0].Account == null) {
        return null;
      }
      return rows[0].Account.Owner.Name;
    } catch (Exception ignored) {
      return null;
    }
  }

  /**
   * Injects the resolved Account Owner into the executive summary once when the
   * NestJS paragraph used the generic Account Manager wording.
   */
  @TestVisible
  private static String enrichSummaryWithAccountOwner(
    String summary,
    String ownerName
  ) {
    if (String.isBlank(summary) || String.isBlank(ownerName)) {
      return summary;
    }
    if (summary.contains(ownerName)) {
      return summary;
    }
    String needle = 'Account Manager approval is required because';
    if (summary.contains(needle)) {
      return summary.replace(
        needle,
        'Account Manager approval is required from ' + ownerName + ' because'
      );
    }
    return summary;
  }

  // ---- DTOs (mirror apps/ai-api/src/orchestrator/dto/guardrail.ts) ----

  public class SubmitRequest {
    public String workflowId;
    public String caseId;
    public Decimal riskScore;
    public String riskLevel;
    public List<String> policyRulesTriggered;
    public List<String> approvalReasons;
    public String resumeToken;
    public SubmitVerdict verdict;
    public String orchestrationConsoleUrl;
  }

  public class SubmitVerdict {
    public String headline;
    public String summary;
    public List<String> recommendedSteps;
    public List<VerdictHighlight> highlights;
  }

  public class VerdictHighlight {
    public String label;
    public String value;
  }

  public class SubmitResult {
    public Boolean submitted;
    public String processInstanceId;
    public Boolean alreadyPending;
    public Boolean degraded;
  }
}
