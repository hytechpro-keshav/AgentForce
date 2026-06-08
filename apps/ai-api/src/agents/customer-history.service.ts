import { Injectable } from "@nestjs/common";

import { ModelRouter } from "../llm/model-router";
import type { LlmChatRequest } from "../llm/interfaces/llm-contracts";
import type {
  AssertedVsInferred,
  BusinessRiskLevel,
  CustomerContextFinding,
  CustomerContextSynthesis,
  CustomerHistorySynthesisInput,
  CustomerReadBundle,
  CustomerTier,
  EvidenceConfidence,
  InstalledAssetSummary,
  RepeatIncidentSignal,
  SlaClass,
  WarrantyStatus
} from "../orchestrator/dto/customer-context";

const RISK_SYSTEM_PROMPT = [
  "You are a customer business-risk grader for a service orchestrator.",
  "You are given ONLY pre-computed, non-PII signals about an account.",
  "Return ONLY a JSON object: { risk: one of low, medium, high }.",
  "Do not invent facts, do not add names or identifiers, no prose, no markdown."
].join(" ");

/**
 * Node 2 evidence-first synthesis. It turns the read bundle into a
 * structured Customer Context Package where every finding is a
 * value + confidence + provenance + evidenceBasis + asserted/inferred.
 *
 * Evidence-or-abstain is enforced here: tier, SLA/entitlement,
 * warranty, and strategic importance are asserted ONLY from an explicit
 * source. A missing source yields a low-confidence, not-evidenced
 * finding — never a fabricated confident value. The model is used ONLY
 * to grade business risk from the already-evidenced, non-PII signals;
 * it never determines tier, warranty, entitlement, or strategic status.
 */
@Injectable()
export class CustomerHistorySynthesisService {
  constructor(private readonly modelRouter: ModelRouter) {}

  async synthesize(
    input: CustomerHistorySynthesisInput
  ): Promise<CustomerContextSynthesis> {
    const { bundle } = input;

    const customerTier = bundle.accountProfile?.tier
      ? asserted(
          bundle.accountProfile.tier,
          "Salesforce Account",
          `Account tier: ${bundle.accountProfile.tier}`
        )
      : abstain<"unknown">(
          "unknown",
          "Account tier",
          "No Account tier on record"
        );

    const slaClass = CustomerHistorySynthesisService.buildSlaFinding(bundle);
    const warrantyStatus =
      CustomerHistorySynthesisService.buildWarrantyFinding(bundle);
    const repeatIncident =
      CustomerHistorySynthesisService.buildRepeatFinding(bundle);
    const strategicAccount =
      CustomerHistorySynthesisService.buildStrategicFinding(bundle);
    const installedAssets =
      CustomerHistorySynthesisService.buildAssetFinding(bundle);
    const openIncidentCount =
      CustomerHistorySynthesisService.buildOpenIncidentFinding(bundle);
    const escalationHistory =
      CustomerHistorySynthesisService.buildEscalationFinding(bundle);

    const evidencedCount = [
      customerTier,
      slaClass,
      warrantyStatus,
      repeatIncident,
      strategicAccount,
      installedAssets,
      openIncidentCount,
      escalationHistory
    ].filter((finding) => !finding.notEvidenced).length;

    const risk = await this.gradeBusinessRisk(input, {
      tier: customerTier,
      sla: slaClass,
      warranty: warrantyStatus,
      repeat: repeatIncident,
      strategic: strategicAccount,
      open: openIncidentCount,
      escalations: escalationHistory,
      evidencedCount
    });

    return {
      package: {
        customerTier,
        slaClass,
        warrantyStatus,
        repeatIncident,
        strategicAccount,
        installedAssets,
        openIncidentCount,
        escalationHistory,
        businessRisk: risk.finding
      },
      provider: risk.provider,
      model: risk.model,
      fallbackUsed: risk.fallbackUsed,
      latencyMs: risk.latencyMs
    };
  }

  /**
   * Grades business risk. When there is no evidence at all the model is
   * not called (grading nothing is meaningless and wasteful); otherwise
   * the model sees only the safe signals. Any model failure falls back
   * to a deterministic grade so the node always completes.
   */
  private async gradeBusinessRisk(
    input: CustomerHistorySynthesisInput,
    signals: RiskSignals
  ): Promise<{
    finding: CustomerContextFinding<BusinessRiskLevel>;
    provider?: string;
    model?: string;
    fallbackUsed: boolean;
    latencyMs: number;
  }> {
    const confidence: EvidenceConfidence =
      signals.evidencedCount >= 4
        ? "high"
        : signals.evidencedCount >= 2
          ? "medium"
          : "low";

    if (signals.evidencedCount === 0) {
      return {
        finding: {
          value: "unknown",
          confidence: "low",
          provenance: "AI synthesis",
          evidenceBasis: "No evidenced customer signals to assess risk",
          assertedVsInferred: "inferred",
          notEvidenced: true
        },
        fallbackUsed: false,
        latencyMs: 0
      };
    }

    const deterministic = CustomerHistorySynthesisService.fallbackRisk(signals);
    const safeSignals = CustomerHistorySynthesisService.safeSignalPayload(
      input,
      signals
    );
    const startedAt = Date.now();

    try {
      const request: LlmChatRequest = {
        requestId: input.requestId,
        useCase: "agentforce_customer_history",
        tenantId: input.tenantId,
        clientId: input.clientId ?? input.tenantId,
        surface: "orchestrator",
        temperature: 0,
        messages: [
          { role: "system", content: RISK_SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(safeSignals) }
        ]
      };
      const response = await this.modelRouter.chat(request);
      const graded = CustomerHistorySynthesisService.parseRisk(
        response.content,
        deterministic
      );
      return {
        finding: {
          value: graded,
          confidence,
          provenance: "AI synthesis",
          evidenceBasis: CustomerHistorySynthesisService.riskEvidence(signals),
          assertedVsInferred: "inferred"
        },
        provider: response.metadata.provider,
        model: response.metadata.model,
        fallbackUsed: response.metadata.fallbackUsed,
        latencyMs: response.metadata.latencyMs
      };
    } catch {
      // Model unavailable: deterministic grade keeps the node moving.
      return {
        finding: {
          value: deterministic,
          confidence,
          provenance: "Deterministic fallback",
          evidenceBasis: CustomerHistorySynthesisService.riskEvidence(signals),
          assertedVsInferred: "inferred"
        },
        fallbackUsed: true,
        latencyMs: Date.now() - startedAt
      };
    }
  }

  private static buildSlaFinding(
    bundle: CustomerReadBundle
  ): CustomerContextFinding<SlaClass> {
    const entitlement = bundle.entitlement;
    if (!entitlement) {
      return abstain<"unknown">(
        "unknown",
        "Salesforce Entitlement",
        "No entitlement data available"
      );
    }
    if (!entitlement.hasEntitlement) {
      return {
        value: "none",
        confidence: "medium",
        provenance: "Salesforce Entitlement",
        evidenceBasis: "No active entitlement on the account",
        assertedVsInferred: "asserted"
      };
    }
    return asserted(
      entitlement.slaClass ?? "standard",
      "Salesforce Entitlement",
      `SLA class: ${entitlement.slaClass ?? "standard"}`
    );
  }

  private static buildWarrantyFinding(
    bundle: CustomerReadBundle
  ): CustomerContextFinding<WarrantyStatus> {
    const warranty = bundle.warranty;
    if (!warranty || warranty.status === "unknown") {
      return abstain<"unknown">(
        "unknown",
        "Salesforce Asset warranty",
        "No warranty/entitlement record for the asset"
      );
    }
    return asserted(
      warranty.status,
      "Salesforce Asset warranty",
      `Warranty status: ${warranty.status}`
    );
  }

  private static buildRepeatFinding(
    bundle: CustomerReadBundle
  ): CustomerContextFinding<RepeatIncidentSignal> {
    const history = bundle.serviceHistory;
    if (!history) {
      return abstain<RepeatIncidentSignal>(
        { repeat: false, count: 0, windowDays: 0 },
        "Salesforce Case history",
        "No service history available"
      );
    }
    const value: RepeatIncidentSignal = {
      repeat: history.repeatIncidentCount >= 2,
      count: history.repeatIncidentCount,
      windowDays: history.repeatWindowDays
    };
    return asserted(
      value,
      "Salesforce Case history",
      `${history.repeatIncidentCount} cases in ${history.repeatWindowDays}d`
    );
  }

  private static buildStrategicFinding(
    bundle: CustomerReadBundle
  ): CustomerContextFinding<boolean> {
    const strategic = bundle.accountProfile?.strategic;
    if (strategic === undefined) {
      // Never infer strategic importance without an explicit flag.
      return abstain<boolean>(
        false,
        "Salesforce Account flag",
        "No explicit strategic-account flag on record"
      );
    }
    return asserted(
      strategic,
      "Salesforce Account flag",
      `Strategic flag: ${strategic ? "yes" : "no"}`
    );
  }

  private static buildAssetFinding(
    bundle: CustomerReadBundle
  ): CustomerContextFinding<InstalledAssetSummary> {
    const assets = bundle.installedAssets;
    if (!assets) {
      return abstain<InstalledAssetSummary>(
        { totalAssets: 0, modelCount: 0 },
        "Salesforce Asset",
        "No installed-asset data available"
      );
    }
    return asserted(
      assets,
      "Salesforce Asset",
      `${assets.totalAssets} assets across ${assets.modelCount} models`
    );
  }

  private static buildOpenIncidentFinding(
    bundle: CustomerReadBundle
  ): CustomerContextFinding<number> {
    const history = bundle.serviceHistory;
    if (!history) {
      return abstain<number>(
        0,
        "Salesforce Case history",
        "No service history available"
      );
    }
    return asserted(
      history.openIncidentCount,
      "Salesforce Case history",
      `${history.openIncidentCount} open incidents`
    );
  }

  private static buildEscalationFinding(
    bundle: CustomerReadBundle
  ): CustomerContextFinding<number> {
    const history = bundle.serviceHistory;
    if (!history) {
      return abstain<number>(
        0,
        "Salesforce Case history",
        "No escalation history available"
      );
    }
    return asserted(
      history.priorEscalations,
      "Salesforce Case history",
      `${history.priorEscalations} prior escalations`
    );
  }

  /** Deterministic risk grade from the evidenced signals. */
  private static fallbackRisk(signals: RiskSignals): BusinessRiskLevel {
    const strategic = signals.strategic.value === true;
    const repeat = signals.repeat.value.repeat;
    const premium =
      signals.tier.value === "premium" || signals.sla.value === "premium";
    const openIncidents = signals.open.value > 0;
    const escalated = signals.escalations.value > 0;

    if (strategic || (repeat && premium) || (escalated && premium)) {
      return "high";
    }
    if (repeat || premium || openIncidents || escalated) {
      return "medium";
    }
    return "low";
  }

  private static riskEvidence(signals: RiskSignals): string {
    const parts: string[] = [];
    if (signals.strategic.value === true) parts.push("strategic");
    if (signals.repeat.value.repeat) parts.push("repeat-failure");
    if (signals.tier.value === "premium" || signals.sla.value === "premium") {
      parts.push("premium");
    }
    if (signals.open.value > 0) parts.push(`${signals.open.value} open`);
    if (signals.escalations.value > 0) {
      parts.push(`${signals.escalations.value} escalations`);
    }
    return parts.length > 0
      ? `Risk signals: ${parts.join(", ")}`
      : "No elevated risk signals";
  }

  /** Compact, non-PII payload the model is allowed to see. */
  private static safeSignalPayload(
    input: CustomerHistorySynthesisInput,
    signals: RiskSignals
  ): Record<string, unknown> {
    return {
      tier: signals.tier.value,
      slaClass: signals.sla.value,
      warranty: signals.warranty.value,
      strategic: signals.strategic.value,
      repeatFailure: signals.repeat.value.repeat,
      repeatCount: signals.repeat.value.count,
      openIncidents: signals.open.value,
      priorEscalations: signals.escalations.value,
      reportedPriority: input.triagePriority ?? "unknown",
      externalSignals: (input.externalSignals ?? []).map((signal) => ({
        source: signal.source,
        confidence: signal.confidence,
        signals: signal.signals
      }))
    };
  }

  private static parseRisk(
    content: string,
    fallback: BusinessRiskLevel
  ): BusinessRiskLevel {
    const trimmed = content.trim();
    if (!trimmed) {
      return fallback;
    }
    try {
      const start = trimmed.indexOf("{");
      const end = trimmed.lastIndexOf("}");
      const slice =
        start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
      const parsed = JSON.parse(slice) as Record<string, unknown>;
      const raw =
        typeof parsed["risk"] === "string"
          ? (parsed["risk"] as string).toLowerCase()
          : "";
      if (raw === "low" || raw === "medium" || raw === "high") {
        return raw;
      }
      return fallback;
    } catch {
      return fallback;
    }
  }
}

interface RiskSignals {
  tier: CustomerContextFinding<CustomerTier>;
  sla: CustomerContextFinding<SlaClass>;
  warranty: CustomerContextFinding<WarrantyStatus>;
  repeat: CustomerContextFinding<RepeatIncidentSignal>;
  strategic: CustomerContextFinding<boolean>;
  open: CustomerContextFinding<number>;
  escalations: CustomerContextFinding<number>;
  evidencedCount: number;
}

function asserted<T>(
  value: T,
  provenance: string,
  evidenceBasis: string,
  confidence: EvidenceConfidence = "high"
): CustomerContextFinding<T> {
  return {
    value,
    confidence,
    provenance,
    evidenceBasis,
    assertedVsInferred: "asserted" as AssertedVsInferred
  };
}

function abstain<T>(
  value: T,
  provenance: string,
  reason: string
): CustomerContextFinding<T> {
  return {
    value,
    confidence: "low",
    provenance,
    evidenceBasis: reason,
    assertedVsInferred: "inferred",
    notEvidenced: true
  };
}
