/**
 * Node 3 — Knowledge Base Agent contracts.
 *
 * These shapes define the knowledge guidance channel that Node 3 writes
 * to shared workflow state. Like Node 2, Node 3 is READ-ONLY to Salesforce
 * and writes ONLY its own `knowledgeGuidance` channel. Every value surfaced
 * here is a sanitized, non-PII fact (source ids, titles, versions, scores,
 * latency) — never raw chunk content, account ids, or customer names.
 */

/**
 * Reference to a knowledge source that was retrieved by Node 3. Contains
 * only metadata — never raw article content or chunk text.
 */
export interface KnowledgeSourceRef {
  sourceId: string;
  title: string;
  version?: string;
  chunkId?: string;
  retrievalScorePercentile?: number;
}

/**
 * The knowledge guidance answer produced when retrieval succeeds.
 * Contains only a safe summary and source references.
 */
export interface KnowledgeAnswer {
  /**
   * Safe, source-cited guidance text. This is a constructed summary
   * (usually from the retrieval service), not raw chunk content.
   */
  safeSummary: string;
  /**
   * List of source references: id, title, version, chunk ids. These
   * are pointers to the authoritative sources in the vector DB.
   */
  sources: KnowledgeSourceRef[];
  /** Which LLM provider (e.g., "openai") synthesized this answer. */
  provider?: string;
  /** Which LLM model (e.g., "gpt-4") synthesized this answer. */
  model?: string;
  /** Which embedding provider (e.g., "openai") was used for retrieval. */
  embeddingProvider?: string;
  /** Retrieval operation id for audit trail and debugging. */
  retrievalId?: string;
  /** Total latency in milliseconds from query to answer. */
  latencyMs?: number;
  /** True when a fallback provider was used (for observability). */
  fallbackUsed?: boolean;
}

/**
 * The Node 3 state channel and the read model surfaced to the
 * read-only UI. Self-contained and sanitized so the whole channel is
 * safe to persist and render.
 */
export interface KnowledgeGuidanceChannel {
  /** Whether the eligibility gate allowed Node 3 to run. */
  eligible: boolean;
  /** Safe reason string (e.g., "RAG disabled by config"). */
  eligibilityReason?: string;
  /** True when a retrieval provider, vector DB, or adapter was unavailable. */
  degraded: boolean;
  /** Names only of sources that were unavailable (e.g., ["vector-db"]). */
  degradedSources?: string[];

  /**
   * The knowledge guidance outcome. Present when eligible=true.
   * - ANSWERED: retrieval succeeded, sources found, answer produced.
   * - NO_SOURCE: retrieval succeeded but no matching articles found.
   * - undefined: node was skipped (ineligible).
   */
  status?: "ANSWERED" | "NO_SOURCE";

  /** Present when status=ANSWERED. Contains safe summary + source refs. */
  answer?: KnowledgeAnswer;
}

/**
 * Config-driven, cheap eligibility policy for Node 3. Determines whether
 * to run RAG retrieval based on Case criteria and tenant configuration.
 */
export interface KnowledgeEligibilityPolicy {
  /**
   * List of allowed Case origins. If set, Node 3 runs only when
   * context.origin is in this list. If empty or undefined, all origins
   * are allowed. Example: ["Web", "Phone", "Email"].
   */
  allowedOrigins?: string[];
  /**
   * List of allowed priorities (from triage). If set, Node 3 runs only
   * when the triage priority is in this list. If empty or undefined,
   * all priorities are allowed.
   */
  allowedPriorities?: string[];
}

export interface KnowledgeEligibilityResult {
  eligible: boolean;
  /** Safe, non-PII reason string for why eligible=true/false. */
  reason: string;
}

/**
 * Input to Node 3's eligibility check. Pure function, no side effects.
 */
export interface KnowledgeEligibilityInput {
  caseOrigin?: string;
  triagePriority?: string;
  tenantId?: string;
}

/**
 * Input to Node 3's query construction. Carries only non-PII, safe facts
 * from the Case context, triage, and customer history.
 */
export interface KnowledgeQueryInput {
  caseSubject?: string;
  caseDescription?: string;
  triagePriority?: string;
  triageSeverity?: string;
  customerTier?: string;
  productModel?: string;
  warrantyStatus?: string;
  repeatIncidentCount?: number;
  priorFixCount?: number;
}
