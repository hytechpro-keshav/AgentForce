import type {
  OrchestratorVerdict,
  OrchestratorVerdictHighlight,
  OrchestratorVerdictInput
} from "./dto/orchestrator-verdict";

/**
 * Deterministically synthesizes the Final Verdict from the sanitized
 * typed channels. No LLM call, no PII, no chain-of-thought — the verdict
 * is assembled purely from values already present in the channels so it
 * is safe to persist and render, and trivially testable.
 *
 * The verdict is observability-only: downstream nodes never parse it.
 */
export function synthesizeOrchestratorVerdict(
  input: OrchestratorVerdictInput
): OrchestratorVerdict {
  const triage = input.triage;
  const pkg = input.customerContext?.package;
  const knowledge = input.knowledgeGuidance;

  const parts = input.partsLogistics;

  const basis: string[] = [];
  if (triage) basis.push("triage");
  if (pkg) basis.push("customerContext");
  if (knowledge) basis.push("knowledgeGuidance");
  if (parts) basis.push("partsLogistics");

  const priority = triage?.recommendedPriority;
  const risk = pkg?.businessRisk.value;
  const knowledgeAnswered =
    knowledge?.status === "ANSWERED" &&
    (knowledge.answer?.sources?.length ?? 0) > 0;
  const sourceCount = knowledge?.answer?.sources?.length ?? 0;

  const headline = buildHeadline(input, priority, risk, knowledgeAnswered);
  const summary = buildSummary(input, priority, risk, knowledge);
  const recommendedSteps = buildSteps(
    input,
    triage?.suggestedNextStep,
    knowledgeAnswered,
    sourceCount,
    knowledge?.answer?.sources,
    knowledge?.answer?.recommendedActions
  );
  const highlights = buildHighlights(input, priority, risk, knowledge);

  return {
    headline: clip(headline, 160),
    summary: clip(summary, 400),
    recommendedSteps: recommendedSteps
      .map((step) => clip(step, 240))
      .slice(0, 6),
    highlights: highlights.slice(0, 8),
    basis,
    generatedAt: new Date().toISOString()
  };
}

function buildHeadline(
  input: OrchestratorVerdictInput,
  priority: string | undefined,
  risk: string | undefined,
  knowledgeAnswered: boolean
): string {
  const priorityLabel = priority
    ? `${capitalize(priority)} priority case`
    : "Case triaged";
  const clauses: string[] = [priorityLabel];
  if (risk) {
    clauses.push(`${risk} business risk`);
  }
  if (knowledgeAnswered) {
    clauses.push("knowledge guidance available");
  }
  return clauses.join(" · ");
}

function buildSummary(
  input: OrchestratorVerdictInput,
  priority: string | undefined,
  risk: string | undefined,
  knowledge: OrchestratorVerdictInput["knowledgeGuidance"]
): string {
  const parts: string[] = [];
  if (priority) {
    parts.push(`Triage recommends ${priority} priority`);
  } else {
    parts.push("Triage completed");
  }
  if (risk) {
    parts.push(`with ${risk} business risk`);
  }
  let sentence = parts.join(" ") + ".";

  if (knowledge) {
    if (knowledge.status === "ANSWERED") {
      sentence += ` Knowledge base returned ${knowledge.answer?.sources?.length ?? 0} matching source(s).`;
    } else if (knowledge.status === "NO_SOURCE") {
      sentence += " No matching knowledge sources were found.";
    } else if (knowledge.eligible === false) {
      sentence += " Knowledge retrieval was skipped for this case.";
    } else if (knowledge.degraded) {
      sentence += " Knowledge base was temporarily unavailable (degraded).";
    }
  }

  sentence += " " + outcomeSentence(input);
  return sentence.trim();
}

function outcomeSentence(input: OrchestratorVerdictInput): string {
  if (input.status === "waiting_approval") {
    return "Write-back is awaiting out-of-band approval.";
  }
  if (input.status === "rejected") {
    return "Write-back was rejected; the Case was left unchanged.";
  }
  if (input.status === "done") {
    return input.writeBackApplied
      ? "The recommended priority was written back to the Case."
      : "No write-back was applied.";
  }
  return "";
}

function buildSteps(
  input: OrchestratorVerdictInput,
  suggestedNextStep: string | undefined,
  knowledgeAnswered: boolean,
  sourceCount: number,
  sources: { title: string }[] | undefined,
  recommendedActions: { rationale: string }[] | undefined
): string[] {
  const steps: string[] = [];
  if (suggestedNextStep && suggestedNextStep.trim()) {
    steps.push(suggestedNextStep.trim());
  }
  // Prefer typed recommended actions over a generic "review sources"
  // line — machines and humans both benefit from the structured rationale.
  if (recommendedActions && recommendedActions.length > 0) {
    for (const action of recommendedActions.slice(0, 3)) {
      if (action.rationale && action.rationale.trim()) {
        steps.push(action.rationale.trim());
      }
    }
  } else if (knowledgeAnswered) {
    const topTitle = sources?.[0]?.title;
    steps.push(
      topTitle
        ? `Review ${sourceCount} knowledge source(s), starting with "${topTitle}".`
        : `Review ${sourceCount} matching knowledge source(s).`
    );
  }
  if (input.customerContext?.package?.repeatIncident.value.repeat) {
    steps.push(
      "Account shows repeat incidents — consider a proactive follow-up."
    );
  }
  if (input.status === "waiting_approval") {
    steps.push("Approve or reject the write-back via email / Salesforce.");
  } else if (input.status === "done" && input.writeBackApplied) {
    steps.push("Confirm the Case priority reflects the applied write-back.");
  }
  if (steps.length === 0) {
    steps.push("Review the triage output and proceed per standard handling.");
  }
  return steps;
}

function buildHighlights(
  input: OrchestratorVerdictInput,
  priority: string | undefined,
  risk: string | undefined,
  knowledge: OrchestratorVerdictInput["knowledgeGuidance"]
): OrchestratorVerdictHighlight[] {
  const highlights: OrchestratorVerdictHighlight[] = [];
  if (priority) {
    highlights.push({ label: "Priority", value: priority });
  }
  if (risk) {
    highlights.push({ label: "Business risk", value: risk });
  }
  const warranty = input.customerContext?.package?.warrantyStatus.value;
  if (warranty) {
    highlights.push({ label: "Warranty", value: String(warranty) });
  }
  const repeat = input.customerContext?.package?.repeatIncident.value;
  if (repeat) {
    highlights.push({
      label: "Repeat failure",
      value: repeat.repeat
        ? `Yes (${repeat.count} in ${repeat.windowDays}d)`
        : "No"
    });
  }
  if (knowledge) {
    highlights.push({
      label: "Knowledge",
      value:
        knowledge.status === "ANSWERED"
          ? `${knowledge.answer?.sources?.length ?? 0} source(s)`
          : knowledge.status === "NO_SOURCE"
            ? "No match"
            : knowledge.eligible === false
              ? "Skipped"
              : knowledge.degraded
                ? "Degraded"
                : "n/a"
    });
    if (knowledge.answer?.guidanceConfidence) {
      highlights.push({
        label: "Guidance confidence",
        value: knowledge.answer.guidanceConfidence
      });
    }
  }
  const parts = input.partsLogistics;
  if (parts && parts.eligible !== false) {
    highlights.push({
      label: "Parts fulfillment",
      value:
        parts.fulfillmentReadiness ??
        (parts.degraded ? "Degraded" : (parts.status ?? "n/a"))
    });
    const approvals = (parts.partPlans ?? []).filter(
      (p) => p.requiredApproval
    ).length;
    if (approvals > 0) {
      highlights.push({
        label: "Parts approvals",
        value: `${approvals} required`
      });
    }
  }
  highlights.push({
    label: "Write-back",
    value:
      input.status === "waiting_approval"
        ? "Awaiting approval"
        : input.status === "rejected"
          ? "Rejected"
          : input.writeBackApplied
            ? "Applied"
            : "Not applied"
  });
  return highlights;
}

function capitalize(value: string): string {
  return value.length > 0 ? value[0].toUpperCase() + value.slice(1) : value;
}

function clip(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max
    ? `${trimmed.slice(0, max - 1).trimEnd()}…`
    : trimmed;
}
