/**
 * Read-only orchestration view model for the Node 1 case-triage
 * walking skeleton.
 *
 * Everything here is customer/operator-SAFE. The browser only ever
 * sees sanitized status events and the sanitized triage output. No
 * bearer tokens, no raw Case text, and no hidden chain-of-thought
 * reach this layer — and {@link sanitizeSnapshot} drops anything
 * unexpected as defense in depth.
 */

export const ORCHESTRATION_STATUSES = [
  "assigned",
  "running",
  "done",
  "waiting_approval",
  "rejected",
  "failed"
] as const;

export type OrchestrationStatus = (typeof ORCHESTRATION_STATUSES)[number];
export const ORCHESTRATION_NODE_IDS = [
  "triage",
  "customer_history",
  "knowledge",
  "parts_logistics",
  "scheduling"
] as const;
export type OrchestrationNodeId = (typeof ORCHESTRATION_NODE_IDS)[number];

export const TRIAGE_PRIORITIES = ["low", "normal", "high", "critical"] as const;
export type TriagePriority = (typeof TRIAGE_PRIORITIES)[number];

export interface OrchestrationEventDetail {
  label: string;
  value: string;
}

export type OrchestrationTraceValue =
  | string
  | number
  | boolean
  | null
  | OrchestrationTraceValue[]
  | { [key: string]: OrchestrationTraceValue };

export interface OrchestrationStateChange {
  path: string;
  change: "added" | "modified";
  before?: OrchestrationTraceValue;
  after?: OrchestrationTraceValue;
}

export interface OrchestrationTraceSection {
  key: string;
  title: string;
  data: OrchestrationTraceValue;
}

export interface OrchestrationExecutionTrace {
  stepKey: string;
  sections: OrchestrationTraceSection[];
}

export interface OrchestrationFinding<T extends OrchestrationTraceValue> {
  value: T;
  confidence: string;
  provenance: string;
  evidenceBasis: string;
  notEvidenced?: boolean;
}

export interface OrchestrationCustomerContextPackage {
  customerTier: OrchestrationFinding<string>;
  slaClass: OrchestrationFinding<string>;
  warrantyStatus: OrchestrationFinding<string>;
  repeatIncident: OrchestrationFinding<{
    repeat: boolean;
    count: number;
    windowDays: number;
  }>;
  strategicAccount: OrchestrationFinding<boolean>;
  installedAssets: OrchestrationFinding<{
    totalAssets: number;
    modelCount: number;
    primaryModel?: string;
  }>;
  openIncidentCount: OrchestrationFinding<number>;
  escalationHistory: OrchestrationFinding<number>;
  businessRisk: OrchestrationFinding<string>;
}

export interface OrchestrationCustomerContext {
  eligible: boolean;
  eligibilityReason?: string;
  degraded: boolean;
  degradedSources?: string[];
  package?: OrchestrationCustomerContextPackage;
  provider?: string;
  model?: string;
  fallbackUsed?: boolean;
  latencyMs?: number;
}

export interface OrchestrationKnowledgeSource {
  sourceId: string;
  title: string;
  version?: string;
  chunkId?: string;
  retrievalScorePercentile?: number;
}

export type OrchestrationEvidenceConfidence = "high" | "medium" | "low";

export interface OrchestrationActionRecommendation {
  actionType: string;
  confidence: OrchestrationEvidenceConfidence;
  rationale: string;
  requiredApproval: boolean;
}

export interface OrchestrationPartRecommendation {
  partNumber: string;
  description?: string;
  confidence: OrchestrationEvidenceConfidence;
}

export interface OrchestrationSafetyFlag {
  code: string;
  message: string;
  severity: "info" | "warning" | "critical";
}

export interface OrchestrationKnowledgeAnswer {
  safeSummary: string;
  displaySummary?: string;
  guidanceConfidence?: OrchestrationEvidenceConfidence;
  recommendedActions?: OrchestrationActionRecommendation[];
  suggestedParts?: OrchestrationPartRecommendation[];
  safetyFlags?: OrchestrationSafetyFlag[];
  sources: OrchestrationKnowledgeSource[];
  provider?: string;
  model?: string;
  embeddingProvider?: string;
  retrievalId?: string;
  latencyMs?: number;
  fallbackUsed?: boolean;
}

export interface OrchestrationKnowledgeGuidance {
  eligible: boolean;
  eligibilityReason?: string;
  degraded: boolean;
  degradedSources?: string[];
  status?: "ANSWERED" | "NO_SOURCE";
  answer?: OrchestrationKnowledgeAnswer;
}

export interface OrchestrationEtaSegment {
  segment: string;
  hoursMin: number;
  hoursMax: number;
  description?: string;
}

export interface OrchestrationPartPlan {
  partNumber: string;
  partName?: string;
  requestedQuantity: number;
  compatibility: string;
  compatibilityEvidence: string;
  availability: string;
  quantityOnHand?: number;
  fulfillmentWarehouseReference?: string;
  fulfillmentWarehouseName?: string;
  fulfillmentWarehouseRegion?: string;
  sourceWarehouseReference?: string;
  sourceWarehouseName?: string;
  transferRequired?: boolean;
  exceptionType: string;
  reservationStatus: string;
  estimatedArrivalWindow?: string;
  etaSegments?: OrchestrationEtaSegment[];
  confidence: OrchestrationEvidenceConfidence;
  requiredApproval: boolean;
  approvalReason?: string;
  rationale: string;
  kbWarehouseAlignment?: string;
  kbDocumentedWarehouses?: string[];
  kbCrossCheckNote?: string;
  fulfillmentRecordType?: string;
  fulfillmentRecordId?: string;
}

export interface OrchestrationPartsKbCrossCheck {
  status: string;
  alignedCount: number;
  divergentCount: number;
  undocumentedCount: number;
}

export interface OrchestrationPartsWriteOutcome {
  applied: boolean;
  degraded: boolean;
  createdCount: number;
  idempotentSkipCount: number;
}

export interface OrchestrationPartsLogistics {
  eligible: boolean;
  eligibilityReason?: string;
  degraded: boolean;
  degradedSources?: string[];
  status?: "PLANNED" | "PARTIAL" | "UNAVAILABLE" | "SKIPPED";
  partPlans?: OrchestrationPartPlan[];
  fulfillmentReadiness?: string;
  fulfillmentConfidence?: OrchestrationEvidenceConfidence;
  candidateSources?: string[];
  kbCrossCheck?: OrchestrationPartsKbCrossCheck;
  writeOutcome?: OrchestrationPartsWriteOutcome;
  provider?: string;
  latencyMs?: number;
}

export interface OrchestrationTechnicianCandidate {
  resourceReference: string;
  territoryReference?: string;
  territoryMembership?: string;
  matchedSkills: string[];
  missingSkills?: string[];
  skillScore: number;
  availabilityScore: number;
  territoryFitScore: number;
  rankScore: number;
  rank: number;
  earliestAvailableAt?: string;
  rationale: string;
}

export interface OrchestrationProposedWindow {
  earliestStart: string;
  earliestStartBasis: string;
  proposedStart?: string;
  proposedEnd?: string;
  displayWindow?: string;
  durationMinutes?: number;
  windowConfidence: string;
  partsEtaConstrained: boolean;
}

export interface OrchestrationScheduling {
  eligible: boolean;
  eligibilityReason?: string;
  degraded: boolean;
  degradedSources?: string[];
  status?: "PLANNED" | "PROVISIONAL" | "DEFERRED" | "UNSCHEDULABLE" | "SKIPPED";
  schedulingReadiness?: string;
  candidates?: OrchestrationTechnicianCandidate[];
  recommendedResourceReference?: string;
  proposedWindow?: OrchestrationProposedWindow;
  partsEtaConsidered: boolean;
  partsReadinessSeen?: string;
  requiredApproval: boolean;
  approvalReason?: string;
  appointmentStatus?: string;
  confidence?: OrchestrationEvidenceConfidence;
  provider?: string;
  latencyMs?: number;
}

export interface OrchestrationVerdictHighlight {
  label: string;
  value: string;
}

/**
 * Final Verdict — observability-only operator narrative synthesized
 * after Nodes 1-4. Display-only; never a machine contract.
 */
export interface OrchestrationVerdict {
  headline: string;
  summary: string;
  recommendedSteps: string[];
  highlights: OrchestrationVerdictHighlight[];
  basis: string[];
  generatedAt?: string;
}

export interface OrchestrationEvent {
  node: OrchestrationNodeId;
  status: OrchestrationStatus;
  sequence: number;
  occurredAt: string;
  safeSummary?: string;
  details?: OrchestrationEventDetail[];
  trace?: OrchestrationExecutionTrace;
}

export interface OrchestrationTriage {
  recommendedPriority: TriagePriority;
  summary: string;
  suggestedNextStep: string;
  provider: string;
  model: string;
  fallbackUsed: boolean;
  latencyMs: number;
}

export interface OrchestrationSnapshot {
  workflowId: string;
  node: OrchestrationNodeId;
  caseNumber?: string;
  status: OrchestrationStatus;
  approvalRequired: boolean;
  writeBackApplied: boolean;
  failureKind?: string;
  triage?: OrchestrationTriage;
  customerContext?: OrchestrationCustomerContext;
  knowledgeGuidance?: OrchestrationKnowledgeGuidance;
  partsLogistics?: OrchestrationPartsLogistics;
  scheduling?: OrchestrationScheduling;
  orchestratorVerdict?: OrchestrationVerdict;
  events: OrchestrationEvent[];
  updatedAt?: string;
}

export const WORKFLOW_ID_PATTERN =
  /^wf-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const CASE_ID_PATTERN = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;

export function isValidWorkflowId(value: string): boolean {
  return WORKFLOW_ID_PATTERN.test(value);
}

export function isValidCaseId(value: string): boolean {
  return CASE_ID_PATTERN.test(value);
}

export function isTerminalStatus(status: OrchestrationStatus): boolean {
  return status === "done" || status === "rejected" || status === "failed";
}

interface StatusMeta {
  label: string;
  /** Tailwind badge classes for this lifecycle state. */
  tone: string;
}

export const STATUS_META: Record<OrchestrationStatus, StatusMeta> = {
  assigned: { label: "Assigned", tone: "bg-slate-100 text-slate-700" },
  running: { label: "Running", tone: "bg-blue-100 text-blue-700" },
  waiting_approval: {
    label: "Waiting for approval",
    tone: "bg-amber-100 text-amber-800"
  },
  done: { label: "Done", tone: "bg-green-100 text-green-700" },
  rejected: { label: "Rejected", tone: "bg-red-100 text-red-700" },
  failed: { label: "Failed", tone: "bg-red-100 text-red-700" }
};

export function statusLabel(status: OrchestrationStatus): string {
  return STATUS_META[status]?.label ?? status;
}

function isStatus(value: unknown): value is OrchestrationStatus {
  return (
    typeof value === "string" &&
    (ORCHESTRATION_STATUSES as readonly string[]).includes(value)
  );
}

function isPriority(value: unknown): value is TriagePriority {
  return (
    typeof value === "string" &&
    (TRIAGE_PRIORITIES as readonly string[]).includes(value)
  );
}

function isNodeId(value: unknown): value is OrchestrationNodeId {
  return (
    typeof value === "string" &&
    (ORCHESTRATION_NODE_IDS as readonly string[]).includes(value)
  );
}

function str(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : undefined;
}

function sanitizeTriage(value: unknown): OrchestrationTriage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (!isPriority(record.recommendedPriority)) return undefined;
  return {
    recommendedPriority: record.recommendedPriority,
    summary: str(record.summary, 280) ?? "",
    suggestedNextStep: str(record.suggestedNextStep, 280) ?? "",
    provider: str(record.provider, 60) ?? "",
    model: str(record.model, 120) ?? "",
    fallbackUsed: record.fallbackUsed === true,
    latencyMs:
      typeof record.latencyMs === "number" && record.latencyMs >= 0
        ? Math.round(record.latencyMs)
        : 0
  };
}

function sanitizeTraceValue(
  value: unknown,
  depth = 0
): OrchestrationTraceValue | undefined {
  if (value === null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, 400) : undefined;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (depth >= 4) {
    return undefined;
  }
  if (Array.isArray(value)) {
    const items = value
      .slice(0, 20)
      .map((item) => sanitizeTraceValue(item, depth + 1))
      .filter((item): item is OrchestrationTraceValue => item !== undefined);
    return items;
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const entries = Object.entries(value as Record<string, unknown>).slice(0, 24);
  const out: Record<string, OrchestrationTraceValue> = {};
  for (const [key, raw] of entries) {
    const safeKey = key.trim().slice(0, 60);
    if (!safeKey) continue;
    const safeValue = sanitizeTraceValue(raw, depth + 1);
    if (safeValue !== undefined) {
      out[safeKey] = safeValue;
    }
  }
  return out;
}

function sanitizeTrace(
  value: unknown
): OrchestrationExecutionTrace | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const stepKey = str(record.stepKey, 80);
  const rawSections = Array.isArray(record.sections) ? record.sections : [];
  const sections: OrchestrationTraceSection[] = [];
  for (const rawSection of rawSections.slice(0, 12)) {
    if (!rawSection || typeof rawSection !== "object") continue;
    const sectionRecord = rawSection as Record<string, unknown>;
    const key = str(sectionRecord.key, 40);
    const title = str(sectionRecord.title, 80);
    const data = sanitizeTraceValue(sectionRecord.data);
    if (!key || !title || data === undefined) continue;
    sections.push({ key, title, data });
  }
  if (!stepKey || sections.length === 0) return undefined;
  return { stepKey, sections };
}

function sanitizeFinding<T extends OrchestrationTraceValue>(
  value: unknown
): OrchestrationFinding<T> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const findingValue = sanitizeTraceValue(record.value);
  const confidence = str(record.confidence, 24);
  const provenance = str(record.provenance, 120);
  const evidenceBasis = str(record.evidenceBasis, 240);
  if (
    findingValue === undefined ||
    !confidence ||
    !provenance ||
    !evidenceBasis
  ) {
    return undefined;
  }
  return {
    value: findingValue as T,
    confidence,
    provenance,
    evidenceBasis,
    notEvidenced: record.notEvidenced === true
  };
}

function sanitizeCustomerContext(
  value: unknown
): OrchestrationCustomerContext | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const rawPackage = record.package;
  const pkg =
    rawPackage && typeof rawPackage === "object"
      ? (rawPackage as Record<string, unknown>)
      : undefined;
  const customerTier = pkg
    ? sanitizeFinding<string>(pkg.customerTier)
    : undefined;
  const slaClass = pkg ? sanitizeFinding<string>(pkg.slaClass) : undefined;
  const warrantyStatus = pkg
    ? sanitizeFinding<string>(pkg.warrantyStatus)
    : undefined;
  const repeatIncident = pkg
    ? sanitizeFinding<{
        repeat: boolean;
        count: number;
        windowDays: number;
      }>(pkg.repeatIncident)
    : undefined;
  const strategicAccount = pkg
    ? sanitizeFinding<boolean>(pkg.strategicAccount)
    : undefined;
  const installedAssets = pkg
    ? sanitizeFinding<{
        totalAssets: number;
        modelCount: number;
        primaryModel?: string;
      }>(pkg.installedAssets)
    : undefined;
  const openIncidentCount = pkg
    ? sanitizeFinding<number>(pkg.openIncidentCount)
    : undefined;
  const escalationHistory = pkg
    ? sanitizeFinding<number>(pkg.escalationHistory)
    : undefined;
  const businessRisk = pkg
    ? sanitizeFinding<string>(pkg.businessRisk)
    : undefined;
  const customerPackage =
    customerTier &&
    slaClass &&
    warrantyStatus &&
    repeatIncident &&
    strategicAccount &&
    installedAssets &&
    openIncidentCount &&
    escalationHistory &&
    businessRisk
      ? {
          customerTier,
          slaClass,
          warrantyStatus,
          repeatIncident,
          strategicAccount,
          installedAssets,
          openIncidentCount,
          escalationHistory,
          businessRisk
        }
      : undefined;
  return {
    eligible: record.eligible === true,
    eligibilityReason: str(record.eligibilityReason, 240),
    degraded: record.degraded === true,
    degradedSources: Array.isArray(record.degradedSources)
      ? record.degradedSources
          .map((item) => str(item, 40))
          .filter((item): item is string => Boolean(item))
          .slice(0, 12)
      : undefined,
    package: customerPackage,
    provider: str(record.provider, 60),
    model: str(record.model, 120),
    fallbackUsed: record.fallbackUsed === true,
    latencyMs:
      typeof record.latencyMs === "number" && record.latencyMs >= 0
        ? Math.round(record.latencyMs)
        : undefined
  };
}

function sanitizeKnowledgeSource(
  value: unknown
): OrchestrationKnowledgeSource | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const sourceId = str(record.sourceId, 120);
  const title = str(record.title, 240);
  if (!sourceId || !title) {
    return undefined;
  }
  return {
    sourceId,
    title,
    version: str(record.version, 60),
    chunkId: str(record.chunkId, 120),
    retrievalScorePercentile:
      typeof record.retrievalScorePercentile === "number" &&
      record.retrievalScorePercentile >= 0
        ? Math.round(record.retrievalScorePercentile)
        : undefined
  };
}

function isConfidence(
  value: unknown
): value is OrchestrationEvidenceConfidence {
  return value === "high" || value === "medium" || value === "low";
}

function sanitizeActionRecommendations(
  value: unknown
): OrchestrationActionRecommendation[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: OrchestrationActionRecommendation[] = [];
  for (const raw of value) {
    if (out.length >= 6) break;
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const actionType = str(record.actionType, 40);
    const rationale = str(record.rationale, 240);
    if (!actionType || !rationale) continue;
    out.push({
      actionType,
      rationale,
      confidence: isConfidence(record.confidence) ? record.confidence : "low",
      requiredApproval: record.requiredApproval === true
    });
  }
  return out.length > 0 ? out : undefined;
}

function sanitizeParts(
  value: unknown
): OrchestrationPartRecommendation[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: OrchestrationPartRecommendation[] = [];
  for (const raw of value) {
    if (out.length >= 6) break;
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const partNumber = str(record.partNumber, 60);
    if (!partNumber) continue;
    out.push({
      partNumber,
      description: str(record.description, 120),
      confidence: isConfidence(record.confidence) ? record.confidence : "low"
    });
  }
  return out.length > 0 ? out : undefined;
}

function sanitizeSafetyFlags(
  value: unknown
): OrchestrationSafetyFlag[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: OrchestrationSafetyFlag[] = [];
  for (const raw of value) {
    if (out.length >= 6) break;
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const code = str(record.code, 40);
    const message = str(record.message, 160);
    if (!code || !message) continue;
    const severity =
      record.severity === "info" ||
      record.severity === "warning" ||
      record.severity === "critical"
        ? record.severity
        : "info";
    out.push({ code, message, severity });
  }
  return out.length > 0 ? out : undefined;
}

function sanitizeKnowledgeAnswer(
  value: unknown
): OrchestrationKnowledgeAnswer | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const safeSummary = str(record.safeSummary, 1000);
  const sources = Array.isArray(record.sources)
    ? record.sources
        .map((item) => sanitizeKnowledgeSource(item))
        .filter((item): item is OrchestrationKnowledgeSource => Boolean(item))
        .slice(0, 10)
    : [];
  if (!safeSummary) {
    return undefined;
  }
  return {
    safeSummary,
    displaySummary: str(record.displaySummary, 1000),
    guidanceConfidence: isConfidence(record.guidanceConfidence)
      ? record.guidanceConfidence
      : undefined,
    recommendedActions: sanitizeActionRecommendations(
      record.recommendedActions
    ),
    suggestedParts: sanitizeParts(record.suggestedParts),
    safetyFlags: sanitizeSafetyFlags(record.safetyFlags),
    sources,
    provider: str(record.provider, 60),
    model: str(record.model, 120),
    embeddingProvider: str(record.embeddingProvider, 60),
    retrievalId: str(record.retrievalId, 120),
    latencyMs:
      typeof record.latencyMs === "number" && record.latencyMs >= 0
        ? Math.round(record.latencyMs)
        : undefined,
    fallbackUsed: record.fallbackUsed === true
  };
}

function sanitizeKnowledgeGuidance(
  value: unknown
): OrchestrationKnowledgeGuidance | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const status =
    record.status === "ANSWERED" || record.status === "NO_SOURCE"
      ? record.status
      : undefined;
  return {
    eligible: record.eligible === true,
    eligibilityReason: str(record.eligibilityReason, 240),
    degraded: record.degraded === true,
    degradedSources: Array.isArray(record.degradedSources)
      ? record.degradedSources
          .map((item) => str(item, 40))
          .filter((item): item is string => Boolean(item))
          .slice(0, 12)
      : undefined,
    status,
    answer: sanitizeKnowledgeAnswer(record.answer)
  };
}

function sanitizeEtaSegments(
  value: unknown
): OrchestrationEtaSegment[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: OrchestrationEtaSegment[] = [];
  for (const raw of value) {
    if (out.length >= 6) break;
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const segment = str(record.segment, 40);
    if (!segment) continue;
    const hoursMin =
      typeof record.hoursMin === "number" && record.hoursMin >= 0
        ? Math.round(record.hoursMin)
        : 0;
    const hoursMax =
      typeof record.hoursMax === "number" && record.hoursMax >= 0
        ? Math.round(record.hoursMax)
        : 0;
    out.push({
      segment,
      hoursMin,
      hoursMax,
      description: str(record.description, 80)
    });
  }
  return out.length > 0 ? out : undefined;
}

function sanitizePartPlan(value: unknown): OrchestrationPartPlan | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const partNumber = str(record.partNumber, 60);
  if (!partNumber) return undefined;
  return {
    partNumber,
    partName: str(record.partName, 120),
    requestedQuantity:
      typeof record.requestedQuantity === "number" &&
      record.requestedQuantity >= 0
        ? Math.round(record.requestedQuantity)
        : 1,
    compatibility: str(record.compatibility, 24) ?? "unknown",
    compatibilityEvidence: str(record.compatibilityEvidence, 240) ?? "",
    availability: str(record.availability, 24) ?? "unknown",
    quantityOnHand:
      typeof record.quantityOnHand === "number" && record.quantityOnHand >= 0
        ? Math.round(record.quantityOnHand)
        : undefined,
    fulfillmentWarehouseReference: str(
      record.fulfillmentWarehouseReference,
      40
    ),
    fulfillmentWarehouseName: str(record.fulfillmentWarehouseName, 120),
    fulfillmentWarehouseRegion: str(record.fulfillmentWarehouseRegion, 40),
    sourceWarehouseReference: str(record.sourceWarehouseReference, 40),
    sourceWarehouseName: str(record.sourceWarehouseName, 120),
    transferRequired: record.transferRequired === true,
    exceptionType: str(record.exceptionType, 40) ?? "none",
    reservationStatus: str(record.reservationStatus, 40) ?? "none",
    estimatedArrivalWindow: str(record.estimatedArrivalWindow, 80),
    etaSegments: sanitizeEtaSegments(record.etaSegments),
    confidence: isConfidence(record.confidence) ? record.confidence : "low",
    requiredApproval: record.requiredApproval === true,
    approvalReason: str(record.approvalReason, 40),
    rationale: str(record.rationale, 280) ?? "",
    kbWarehouseAlignment: str(record.kbWarehouseAlignment, 24),
    kbDocumentedWarehouses: Array.isArray(record.kbDocumentedWarehouses)
      ? record.kbDocumentedWarehouses
          .map((item) => str(item, 40))
          .filter((item): item is string => Boolean(item))
          .slice(0, 8)
      : undefined,
    kbCrossCheckNote: str(record.kbCrossCheckNote, 240),
    fulfillmentRecordType: str(record.fulfillmentRecordType, 40),
    fulfillmentRecordId: str(record.fulfillmentRecordId, 24)
  };
}

function sanitizePartsWriteOutcome(
  value: unknown
): OrchestrationPartsWriteOutcome | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const count = (v: unknown): number =>
    typeof v === "number" && v >= 0 ? Math.round(v) : 0;
  return {
    applied: record.applied === true,
    degraded: record.degraded === true,
    createdCount: count(record.createdCount),
    idempotentSkipCount: count(record.idempotentSkipCount)
  };
}

function sanitizeKbCrossCheck(
  value: unknown
): OrchestrationPartsKbCrossCheck | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const status = str(record.status, 24);
  if (!status) return undefined;
  const count = (v: unknown): number =>
    typeof v === "number" && v >= 0 ? Math.round(v) : 0;
  return {
    status,
    alignedCount: count(record.alignedCount),
    divergentCount: count(record.divergentCount),
    undocumentedCount: count(record.undocumentedCount)
  };
}

function sanitizePartsLogistics(
  value: unknown
): OrchestrationPartsLogistics | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const status =
    record.status === "PLANNED" ||
    record.status === "PARTIAL" ||
    record.status === "UNAVAILABLE" ||
    record.status === "SKIPPED"
      ? record.status
      : undefined;
  const partPlans = Array.isArray(record.partPlans)
    ? record.partPlans
        .map((item) => sanitizePartPlan(item))
        .filter((item): item is OrchestrationPartPlan => Boolean(item))
        .slice(0, 12)
    : undefined;
  return {
    eligible: record.eligible === true,
    eligibilityReason: str(record.eligibilityReason, 240),
    degraded: record.degraded === true,
    degradedSources: Array.isArray(record.degradedSources)
      ? record.degradedSources
          .map((item) => str(item, 40))
          .filter((item): item is string => Boolean(item))
          .slice(0, 12)
      : undefined,
    status,
    partPlans,
    fulfillmentReadiness: str(record.fulfillmentReadiness, 24),
    fulfillmentConfidence: isConfidence(record.fulfillmentConfidence)
      ? record.fulfillmentConfidence
      : undefined,
    candidateSources: Array.isArray(record.candidateSources)
      ? record.candidateSources
          .map((item) => str(item, 24))
          .filter((item): item is string => Boolean(item))
          .slice(0, 6)
      : undefined,
    kbCrossCheck: sanitizeKbCrossCheck(record.kbCrossCheck),
    writeOutcome: sanitizePartsWriteOutcome(record.writeOutcome),
    provider: str(record.provider, 60),
    latencyMs:
      typeof record.latencyMs === "number" && record.latencyMs >= 0
        ? Math.round(record.latencyMs)
        : undefined
  };
}

function num01(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value * 1000) / 1000
    : 0;
}

function sanitizeSchedulingCandidate(
  value: unknown
): OrchestrationTechnicianCandidate | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  // Defense in depth: only a sanitized, short reference is accepted —
  // never a full technician name. Unknown fields are dropped entirely.
  const resourceReference = str(record.resourceReference, 24);
  if (!resourceReference) return undefined;
  const skills = (input: unknown): string[] =>
    Array.isArray(input)
      ? input
          .map((s) => str(s, 40))
          .filter((s): s is string => Boolean(s))
          .slice(0, 8)
      : [];
  return {
    resourceReference,
    territoryReference: str(record.territoryReference, 40),
    territoryMembership: str(record.territoryMembership, 16),
    matchedSkills: skills(record.matchedSkills),
    missingSkills: Array.isArray(record.missingSkills)
      ? skills(record.missingSkills)
      : undefined,
    skillScore: num01(record.skillScore),
    availabilityScore: num01(record.availabilityScore),
    territoryFitScore: num01(record.territoryFitScore),
    rankScore: num01(record.rankScore),
    rank:
      typeof record.rank === "number" && record.rank >= 0
        ? Math.round(record.rank)
        : 0,
    earliestAvailableAt: str(record.earliestAvailableAt, 40),
    rationale: str(record.rationale, 280) ?? ""
  };
}

function sanitizeProposedWindow(
  value: unknown
): OrchestrationProposedWindow | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const earliestStart = str(record.earliestStart, 40);
  if (!earliestStart) return undefined;
  return {
    earliestStart,
    earliestStartBasis: str(record.earliestStartBasis, 40) ?? "now",
    proposedStart: str(record.proposedStart, 40),
    proposedEnd: str(record.proposedEnd, 40),
    displayWindow: str(record.displayWindow, 120),
    durationMinutes:
      typeof record.durationMinutes === "number" && record.durationMinutes >= 0
        ? Math.round(record.durationMinutes)
        : undefined,
    windowConfidence: str(record.windowConfidence, 16) ?? "low",
    partsEtaConstrained: record.partsEtaConstrained === true
  };
}

function sanitizeScheduling(
  value: unknown
): OrchestrationScheduling | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const status =
    record.status === "PLANNED" ||
    record.status === "PROVISIONAL" ||
    record.status === "DEFERRED" ||
    record.status === "UNSCHEDULABLE" ||
    record.status === "SKIPPED"
      ? record.status
      : undefined;
  const candidates = Array.isArray(record.candidates)
    ? record.candidates
        .map((c) => sanitizeSchedulingCandidate(c))
        .filter((c): c is OrchestrationTechnicianCandidate => Boolean(c))
        .slice(0, 3)
    : undefined;
  return {
    eligible: record.eligible === true,
    eligibilityReason: str(record.eligibilityReason, 240),
    degraded: record.degraded === true,
    degradedSources: Array.isArray(record.degradedSources)
      ? record.degradedSources
          .map((item) => str(item, 40))
          .filter((item): item is string => Boolean(item))
          .slice(0, 12)
      : undefined,
    status,
    schedulingReadiness: str(record.schedulingReadiness, 24),
    candidates,
    recommendedResourceReference: str(record.recommendedResourceReference, 24),
    proposedWindow: sanitizeProposedWindow(record.proposedWindow),
    partsEtaConsidered: record.partsEtaConsidered === true,
    partsReadinessSeen: str(record.partsReadinessSeen, 24),
    requiredApproval: record.requiredApproval === true,
    approvalReason: str(record.approvalReason, 40),
    appointmentStatus: str(record.appointmentStatus, 24),
    confidence: isConfidence(record.confidence) ? record.confidence : undefined,
    provider: str(record.provider, 60),
    latencyMs:
      typeof record.latencyMs === "number" && record.latencyMs >= 0
        ? Math.round(record.latencyMs)
        : undefined
  };
}

function sanitizeVerdictHighlights(
  value: unknown
): OrchestrationVerdictHighlight[] {
  if (!Array.isArray(value)) return [];
  const out: OrchestrationVerdictHighlight[] = [];
  for (const raw of value) {
    if (out.length >= 8) break;
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const label = str(record.label, 40);
    const highlightValue = str(record.value, 80);
    if (!label || !highlightValue) continue;
    out.push({ label, value: highlightValue });
  }
  return out;
}

function sanitizeVerdict(value: unknown): OrchestrationVerdict | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const headline = str(record.headline, 160);
  const summary = str(record.summary, 400);
  if (!headline && !summary) return undefined;
  const recommendedSteps = Array.isArray(record.recommendedSteps)
    ? record.recommendedSteps
        .map((item) => str(item, 240))
        .filter((item): item is string => Boolean(item))
        .slice(0, 6)
    : [];
  const basis = Array.isArray(record.basis)
    ? record.basis
        .map((item) => str(item, 40))
        .filter((item): item is string => Boolean(item))
        .slice(0, 6)
    : [];
  return {
    headline: headline ?? "",
    summary: summary ?? "",
    recommendedSteps,
    highlights: sanitizeVerdictHighlights(record.highlights),
    basis,
    generatedAt: str(record.generatedAt, 40)
  };
}

function sanitizeEvents(value: unknown): OrchestrationEvent[] {
  if (!Array.isArray(value)) return [];
  const out: OrchestrationEvent[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    if (!isStatus(record.status)) continue;
    out.push({
      node: isNodeId(record.node) ? record.node : "triage",
      status: record.status,
      sequence:
        typeof record.sequence === "number" ? record.sequence : out.length + 1,
      occurredAt: str(record.occurredAt, 40) ?? "",
      safeSummary: str(record.safeSummary, 240),
      details: sanitizeDetails(record.details),
      trace: sanitizeTrace(record.trace)
    });
  }
  return out.sort((a, b) => a.sequence - b.sequence);
}

/**
 * Coerce untrusted event details into a safe, bounded label/value list.
 * Caps the number of details and clips each field, dropping anything
 * that is not a non-empty string pair.
 */
function sanitizeDetails(
  value: unknown
): OrchestrationEventDetail[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: OrchestrationEventDetail[] = [];
  for (const raw of value) {
    if (out.length >= 8) break;
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const label = str(record.label, 40);
    const detailValue = str(record.value, 120);
    if (!label || !detailValue) continue;
    out.push({ label, value: detailValue });
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Defensively coerce an untrusted proxy response into a safe
 * snapshot. Returns null when the payload is not a recognizable
 * workflow snapshot.
 */
export function sanitizeSnapshot(value: unknown): OrchestrationSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const workflowId = str(record.workflowId, 64);
  if (!workflowId || !isStatus(record.status)) return null;
  return {
    workflowId,
    node: isNodeId(record.node) ? record.node : "triage",
    caseNumber: str(record.caseNumber, 32),
    status: record.status,
    approvalRequired: record.approvalRequired === true,
    writeBackApplied: record.writeBackApplied === true,
    failureKind: str(record.failureKind, 60),
    triage: sanitizeTriage(record.triage),
    customerContext: sanitizeCustomerContext(record.customerContext),
    knowledgeGuidance: sanitizeKnowledgeGuidance(record.knowledgeGuidance),
    partsLogistics: sanitizePartsLogistics(record.partsLogistics),
    scheduling: sanitizeScheduling(record.scheduling),
    orchestratorVerdict: sanitizeVerdict(record.orchestratorVerdict),
    events: sanitizeEvents(record.events),
    updatedAt: str(record.updatedAt, 40)
  };
}
