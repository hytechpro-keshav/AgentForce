import type {
  OrchestratorVerdict,
  OrchestratorVerdictHighlight,
  OrchestratorVerdictInput
} from "./dto/orchestrator-verdict";
import type {
  PartLogisticsPlan,
  PartsLogisticsChannel
} from "./dto/parts-logistics";

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

  const headline = buildHeadline(
    input,
    priority,
    risk,
    knowledgeAnswered,
    parts
  );
  const summary = buildSummary(input, priority, risk, knowledge, parts);
  const recommendedSteps = buildSteps(
    input,
    triage?.suggestedNextStep,
    knowledgeAnswered,
    sourceCount,
    knowledge?.answer?.sources,
    knowledge?.answer?.recommendedActions,
    parts
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
  _input: OrchestratorVerdictInput,
  priority: string | undefined,
  risk: string | undefined,
  knowledgeAnswered: boolean,
  parts: PartsLogisticsChannel | undefined
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
  const partsClause = buildPartsHeadlineClause(parts);
  if (partsClause) {
    clauses.push(partsClause);
  }
  return clauses.join(" · ");
}

function buildPartsHeadlineClause(
  parts: PartsLogisticsChannel | undefined
): string | undefined {
  if (!parts || parts.eligible === false) {
    return undefined;
  }
  if (parts.degraded) {
    return "parts inventory degraded";
  }
  switch (parts.fulfillmentReadiness) {
    case "ready":
      return "parts available";
    case "partial":
      return "parts transfer required";
    case "blocked":
      return "parts fulfillment blocked";
    default:
      return undefined;
  }
}

function buildSummary(
  input: OrchestratorVerdictInput,
  priority: string | undefined,
  risk: string | undefined,
  knowledge: OrchestratorVerdictInput["knowledgeGuidance"],
  partsLogistics: PartsLogisticsChannel | undefined
): string {
  const triageParts: string[] = [];
  if (priority) {
    triageParts.push(`Triage recommends ${priority} priority`);
  } else {
    triageParts.push("Triage completed");
  }
  if (risk) {
    triageParts.push(`with ${risk} business risk`);
  }
  let sentence = triageParts.join(" ") + ".";

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

  const partsSentence = buildPartsSummarySentence(partsLogistics);
  if (partsSentence) {
    sentence += ` ${partsSentence}`;
  }

  const divergent = partsLogistics?.kbCrossCheck?.divergentCount ?? 0;
  if (divergent > 0) {
    sentence += ` KB warehouse cross-check flagged ${divergent} divergent routing(s).`;
  }

  sentence += " " + outcomeSentence(input);
  return sentence.trim();
}

function buildPartsSummarySentence(
  parts: PartsLogisticsChannel | undefined
): string | undefined {
  if (!parts) {
    return undefined;
  }
  if (parts.eligible === false) {
    return "Parts logistics was not eligible for this case.";
  }
  if (parts.degraded) {
    return "Parts logistics ran in degraded mode; inventory reads were incomplete.";
  }

  const primary = parts.partPlans?.[0];
  const moreSuffix =
    (parts.partPlans?.length ?? 0) > 1
      ? ` (+${(parts.partPlans?.length ?? 0) - 1} more)`
      : "";

  if (!primary) {
    return undefined;
  }

  if (
    parts.fulfillmentReadiness === "partial" &&
    primary.transferRequired &&
    primary.sourceWarehouseReference &&
    primary.fulfillmentWarehouseReference
  ) {
    const eta = formatPartsEta(primary);
    const etaClause = eta ? ` (ETA up to ${eta})` : "";
    return `Parts plan: ${primary.partNumber} requires inter-warehouse transfer from ${primary.sourceWarehouseReference} to ${primary.fulfillmentWarehouseReference}${etaClause}.${moreSuffix}`;
  }

  if (
    parts.fulfillmentReadiness === "ready" &&
    primary.fulfillmentWarehouseReference
  ) {
    return `Parts plan: ${primary.partNumber} is available at ${primary.fulfillmentWarehouseReference}.${moreSuffix}`;
  }

  if (parts.fulfillmentReadiness === "blocked") {
    return `Parts fulfillment blocked for ${primary.partNumber} (${primary.exceptionType}).${moreSuffix}`;
  }

  return undefined;
}

function formatPartsEta(plan: PartLogisticsPlan): string | undefined {
  if (plan.estimatedArrivalWindow) {
    return plan.estimatedArrivalWindow;
  }
  if (plan.estimatedDispatchHoursMax !== undefined) {
    return `${plan.estimatedDispatchHoursMax}h`;
  }
  return undefined;
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
  recommendedActions: { rationale: string }[] | undefined,
  partsLogistics: PartsLogisticsChannel | undefined
): string[] {
  const coreSteps: string[] = [];
  const genericSteps: string[] = [];

  if (suggestedNextStep && suggestedNextStep.trim()) {
    coreSteps.push(suggestedNextStep.trim());
  }
  // Prefer typed recommended actions over a generic "review sources"
  // line — machines and humans both benefit from the structured rationale.
  if (recommendedActions && recommendedActions.length > 0) {
    for (const action of recommendedActions.slice(0, 3)) {
      if (action.rationale && action.rationale.trim()) {
        coreSteps.push(action.rationale.trim());
      }
    }
  } else if (knowledgeAnswered) {
    const topTitle = sources?.[0]?.title;
    genericSteps.push(
      topTitle
        ? `Review ${sourceCount} knowledge source(s), starting with "${topTitle}".`
        : `Review ${sourceCount} matching knowledge source(s).`
    );
  }

  const partsSteps = buildPartsSteps(partsLogistics);
  coreSteps.push(...partsSteps);

  if (input.customerContext?.package?.repeatIncident.value.repeat) {
    genericSteps.push(
      "Account shows repeat incidents — consider a proactive follow-up."
    );
  }
  if (input.status === "waiting_approval") {
    genericSteps.push("Approve or reject the write-back via email / Salesforce.");
  } else if (input.status === "done" && input.writeBackApplied) {
    genericSteps.push(
      "Confirm the Case priority reflects the applied write-back."
    );
  }

  const steps = [...coreSteps, ...genericSteps];
  if (steps.length === 0) {
    steps.push("Review the triage output and proceed per standard handling.");
  }
  return trimStepsToBudget(steps);
}

function buildPartsSteps(
  parts: PartsLogisticsChannel | undefined
): string[] {
  if (!parts || parts.eligible === false || parts.degraded) {
    return [];
  }

  const primary = parts.partPlans?.[0];
  if (!primary) {
    return [];
  }

  const steps: string[] = [];

  if (primary.requiredApproval) {
    steps.push(
      `Approve parts action: ${primary.partNumber} (${primary.approvalReason ?? "approval required"}).`
    );
  }

  if (
    primary.transferRequired &&
    primary.sourceWarehouseReference &&
    primary.fulfillmentWarehouseReference
  ) {
    // Past tense once the gated write created the transfer (4c).
    steps.push(
      primary.reservationStatus === "transfer_pending"
        ? `Inter-warehouse transfer initiated for ${primary.partNumber} (${primary.sourceWarehouseReference} → ${primary.fulfillmentWarehouseReference}); track to fulfillment WH.`
        : `Initiate inter-warehouse transfer for ${primary.partNumber} from ${primary.sourceWarehouseReference} to ${primary.fulfillmentWarehouseReference}.`
    );
  } else if (primary.availability === "available" && primary.fulfillmentWarehouseReference) {
    steps.push(
      `Dispatch ${primary.partNumber} from ${primary.fulfillmentWarehouseReference}.`
    );
  } else if (primary.exceptionType === "backorder") {
    steps.push(
      primary.reservationStatus === "backorder_requested"
        ? `Backorder requested for ${primary.partNumber}; track replenishment to fulfillment WH.`
        : `Create backorder request for ${primary.partNumber}.`
    );
  } else if (primary.exceptionType === "catalog_gap") {
    steps.push(
      "Review catalog gap for requested part; manual sourcing required."
    );
  }

  return steps;
}

/** Keep triage + knowledge + parts steps; drop lowest-priority generic steps first. */
function trimStepsToBudget(steps: string[]): string[] {
  const maxSteps = 6;
  if (steps.length <= maxSteps) {
    return steps;
  }
  const genericPatterns = [
    /^Review \d+ (matching )?knowledge source/,
    /^Account shows repeat incidents/,
    /^Confirm the Case priority reflects/,
    /^Approve or reject the write-back/
  ];
  const trimmed = [...steps];
  while (trimmed.length > maxSteps) {
    const dropIndex = trimmed.findIndex((step) =>
      genericPatterns.some((pattern) => pattern.test(step))
    );
    if (dropIndex === -1) {
      trimmed.pop();
    } else {
      trimmed.splice(dropIndex, 1);
    }
  }
  return trimmed;
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
    const primary = parts.partPlans?.[0];
    if (primary) {
      highlights.push({
        label: "Primary part",
        value: primary.partNumber
      });
      if (primary.fulfillmentWarehouseReference) {
        highlights.push({
          label: "Fulfillment WH",
          value: primary.fulfillmentWarehouseReference
        });
      }
      if (
        primary.transferRequired &&
        primary.sourceWarehouseReference &&
        primary.fulfillmentWarehouseReference
      ) {
        highlights.push({
          label: "Transfer",
          value: `Yes (${primary.sourceWarehouseReference} → ${primary.fulfillmentWarehouseReference})`
        });
      } else {
        highlights.push({ label: "Transfer", value: "No" });
      }
      const eta = formatPartsEta(primary);
      if (eta) {
        highlights.push({ label: "Parts ETA", value: eta });
      }
    }
    const approvals = (parts.partPlans ?? []).filter(
      (p) => p.requiredApproval
    ).length;
    if (approvals > 0) {
      highlights.push({
        label: "Parts approvals",
        value: `${approvals} required`
      });
    }
    if (parts.kbCrossCheck && parts.kbCrossCheck.status !== "SKIPPED") {
      const cc = parts.kbCrossCheck;
      highlights.push({
        label: "KB alignment",
        value:
          cc.status === "UNDOCUMENTED"
            ? "Undocumented"
            : `aligned ${cc.alignedCount} / divergent ${cc.divergentCount}`
      });
    }
    if (parts.writeOutcome?.applied) {
      const wo = parts.writeOutcome;
      highlights.push({
        label: "Parts writes",
        value: wo.degraded
          ? "Degraded"
          : `${wo.createdCount} created${wo.idempotentSkipCount > 0 ? `, ${wo.idempotentSkipCount} reused` : ""}`
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
