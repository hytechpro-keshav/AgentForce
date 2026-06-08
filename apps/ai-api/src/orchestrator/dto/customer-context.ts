import type { TriagePriorityDto } from "../../agents/dto/triage-case.dto";

/**
 * Node 2 — Customer History Agent contracts.
 *
 * These shapes evolve the Node 1 `CaseTriageState` toward a multi-node
 * `ServiceWorkflowState`. Node 2 is READ-ONLY to Salesforce and writes
 * ONLY its own `customerContext` channel. Every value surfaced here is
 * a sanitized, non-PII fact (tier, SLA class, counts, model names,
 * confidence) — never names, contact details, account ids, or raw
 * records.
 */

/** Graded confidence; downgraded automatically when sources are missing. */
export type EvidenceConfidence = "high" | "medium" | "low";

/** Separates directly-read facts from synthesized conclusions. */
export type AssertedVsInferred = "asserted" | "inferred";

/**
 * A single Customer Context Package finding. The package is structured
 * (value + metadata) so downstream nodes branch on values and a
 * reviewer can audit WHY a finding was asserted — never prose.
 */
export interface CustomerContextFinding<T> {
  value: T;
  confidence: EvidenceConfidence;
  /**
   * Which system + record CLASS supplied the value (e.g.
   * "Salesforce Entitlement"), by reference — never a raw payload.
   */
  provenance: string;
  /**
   * What was actually observed (e.g. "2 prior Cases on model VX-900 in
   * 30 days"). Safe, non-PII evidence basis only.
   */
  evidenceBasis: string;
  assertedVsInferred: AssertedVsInferred;
  /**
   * True when NO source backed this finding. Evidence-or-abstain: a
   * missing source yields a low-confidence, not-evidenced finding
   * rather than a fabricated confident value.
   */
  notEvidenced?: boolean;
}

export type CustomerTier = "premium" | "standard" | "basic" | "unknown";
export type SlaClass = "premium" | "standard" | "none" | "unknown";
export type WarrantyStatus = "covered" | "expired" | "rma_eligible" | "unknown";
export type BusinessRiskLevel = "low" | "medium" | "high" | "unknown";

export interface RepeatIncidentSignal {
  repeat: boolean;
  count: number;
  windowDays: number;
}

export interface InstalledAssetSummary {
  totalAssets: number;
  modelCount: number;
  /** Safe, non-PII model identifier (e.g. "VX-900"). Optional. */
  primaryModel?: string;
}

/**
 * The structured Customer Context Package Node 2 enriches state with.
 * Descriptive, never prescriptive: it states the situation; Nodes 5/6
 * decide what to do with it.
 */
export interface CustomerContextPackage {
  customerTier: CustomerContextFinding<CustomerTier>;
  slaClass: CustomerContextFinding<SlaClass>;
  warrantyStatus: CustomerContextFinding<WarrantyStatus>;
  repeatIncident: CustomerContextFinding<RepeatIncidentSignal>;
  strategicAccount: CustomerContextFinding<boolean>;
  installedAssets: CustomerContextFinding<InstalledAssetSummary>;
  openIncidentCount: CustomerContextFinding<number>;
  escalationHistory: CustomerContextFinding<number>;
  businessRisk: CustomerContextFinding<BusinessRiskLevel>;
}

/**
 * The Node 2 state channel and the read model surfaced to the
 * read-only UI. Self-contained and sanitized so the whole channel is
 * safe to persist and render.
 */
export interface CustomerContextChannel {
  /** Whether the cheap eligibility gate allowed Node 2 to run. */
  eligible: boolean;
  /** Safe, non-PII reason string (e.g. "origin=Web priority=high"). */
  eligibilityReason?: string;
  /** True when a source or enabled adapter was unavailable. */
  degraded: boolean;
  /** Names only of sources that were unavailable (e.g. ["warranty"]). */
  degradedSources?: string[];
  /** The synthesized package. Absent when skipped (ineligible). */
  package?: CustomerContextPackage;
  /** Provider used for the risk synthesis, for operator transparency. */
  provider?: string;
  model?: string;
  fallbackUsed?: boolean;
  latencyMs?: number;
}

/**
 * Scope for every customer read. The Account id is the REQUIRED anchor
 * — the primary control against cross-customer contamination. Reads are
 * tenant- AND Account-scoped; no cross-account queries are ever issued.
 * `verifiedContactId` applies the verified-contact scoping
 * (`WHERE ContactId = VerifiedCustomerId`) when present.
 */
export interface CustomerReadScope {
  accountId: string;
  tenantId?: string;
  verifiedContactId?: string;
}

export interface CustomerAccountProfile {
  /** Raw Account tier/segment label mapped to the tier vocabulary. */
  tier?: CustomerTier;
  /** Explicit strategic-account flag only — never inferred from spend. */
  strategic?: boolean;
}

export interface CustomerEntitlementSla {
  hasEntitlement: boolean;
  slaClass?: SlaClass;
}

export interface CustomerWarranty {
  status: WarrantyStatus;
}

export interface CustomerServiceHistory {
  priorCaseCount: number;
  repeatIncidentCount: number;
  repeatWindowDays: number;
  priorEscalations: number;
  openIncidentCount: number;
}

/**
 * The bundle of read slices the synthesis consumes. Any absent slice
 * makes the corresponding finding abstain (low confidence + not
 * evidenced). `missingSources` records which sources were unavailable
 * so the channel can flag degraded mode without leaking detail.
 */
export interface CustomerReadBundle {
  /** Where the bundle came from: a single Data 360 graph call or SOQL. */
  source: "data_cloud" | "soql" | "none";
  accountProfile?: CustomerAccountProfile;
  entitlement?: CustomerEntitlementSla;
  warranty?: CustomerWarranty;
  installedAssets?: InstalledAssetSummary;
  serviceHistory?: CustomerServiceHistory;
  missingSources: string[];
}

/**
 * Config-driven, cheap eligibility policy. Mirrors Service Assistant's
 * "Check Service Plan Eligibility": gate the expensive reads + model
 * call on Case criteria so low-value Cases skip Node 2.
 */
export interface CustomerHistoryEligibilityPolicy {
  eligibleOrigins?: string[];
  eligiblePriorities?: TriagePriorityDto[];
}

export interface CustomerHistoryEligibilityResult {
  eligible: boolean;
  /** Safe, non-PII reason string. */
  reason: string;
}

/**
 * A safe, non-PII signal returned by an external context adapter
 * (ERP / ServiceNow / asset telemetry). Only sanitized facts cross the
 * adapter boundary — never raw records, names, or account ids.
 */
export interface ExternalContextSignal {
  source: string;
  confidence: EvidenceConfidence;
  signals: Record<string, string | number | boolean>;
}

/**
 * Result of the Node 2 read stage: the assembled customer bundle plus
 * any external adapter signals and the names of external sources that
 * were unavailable. Salesforce per-source misses are carried inside
 * `bundle.missingSources`.
 */
export interface CustomerHistoryReadResult {
  bundle: CustomerReadBundle;
  externalSignals: ExternalContextSignal[];
  degradedSources: string[];
}

/**
 * Input to the Node 2 synthesis stage. Carries only the bundle, the
 * non-PII external signals, and the triage priority hint.
 */
export interface CustomerHistorySynthesisInput {
  bundle: CustomerReadBundle;
  triagePriority?: TriagePriorityDto;
  externalSignals?: ExternalContextSignal[];
  requestId?: string;
  tenantId?: string;
  clientId?: string;
}

/** Output of the Node 2 synthesis stage: the package plus model meta. */
export interface CustomerContextSynthesis {
  package: CustomerContextPackage;
  provider?: string;
  model?: string;
  fallbackUsed: boolean;
  latencyMs: number;
}
