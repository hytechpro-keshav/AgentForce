/**
 * Node 5 — Scheduling contracts (Phase 5a, read/plan only).
 *
 * Node 5 is READ-ONLY to Salesforce and NON-interrupting. It reads the
 * Case asset + ship-to, the upstream `partsLogistics` readiness/ETA, and
 * live Field Service signals (technicians, skills, territory membership,
 * operating hours), then writes ONLY its own `scheduling` channel. Node 6
 * owns human approval; Node 5 never calls `interrupt()`.
 *
 * Every value surfaced here is a sanitized, non-PII fact: a stable
 * technician REFERENCE (resource code / initials — never the full
 * `ServiceResource.Name`), territory reference, matched skill labels, an
 * ISO service window, and the reason a window cannot be earlier (parts
 * ETA, availability, SLA). Phase 5a writes no Salesforce records —
 * `appointmentStatus` stops at `proposed`.
 *
 * Central design rule (mirrors Node 4's "remote stock is not
 * availability"): a free technician slot is NOT a schedulable window if
 * the parts have not arrived. `earliestStart = max(partsEtaFloor,
 * technicianAvailability, now)` (§3.5).
 *
 * 5a is POINT-IN-TIME (§3.7): `deferred` / `provisional` reflect parts
 * readiness as of this run only. After `done` the window is historical,
 * not a live booking — 5c re-reads parts at write time, 5d reconciles on
 * inventory events.
 */

import type { EvidenceConfidence } from "./customer-context";

export type { EvidenceConfidence } from "./customer-context";

export const SCHEDULING_NODE_ID = "scheduling" as const;

/** Aggregate schedulability outcome for the Case. */
export type SchedulingReadiness =
  | "schedulable" // committed window proposed
  | "provisional" // window depends on parts transfer / degraded reads
  | "deferred" // parts blocked — schedule only after parts confirmed
  | "unschedulable" // no eligible technician (skill / territory / availability)
  | "unknown"; // scheduling read failed

/** Which constraint set the earliest-start floor (verdict explainability). */
export type EarliestStartBasis =
  | "parts_eta"
  | "technician_availability"
  | "sla_target"
  | "now";

/** Why a proposed plan needs Node 6 approval (surfaced, not gated in 5a). */
export type SchedulingApprovalReason =
  | "none"
  | "after_hours"
  | "sla_breach_risk"
  | "cross_territory"
  | "parts_not_ready";

/** A single ranked technician candidate (sanitized — never a full name). */
export interface TechnicianCandidate {
  /** Stable, non-PII reference — resource code or initials (e.g. "SR-A1"). */
  resourceReference: string;
  territoryReference?: string;
  /** Membership type in the target territory: Primary | Secondary. */
  territoryMembership?: "primary" | "secondary";
  /** Skills that matched the Case's required skill(s). */
  matchedSkills: string[];
  missingSkills?: string[];
  /** 0–1 sub-scores feeding the composite rank. */
  skillScore: number;
  availabilityScore: number;
  territoryFitScore: number;
  /** Composite rank score (higher = better); rank 1 is the recommendation. */
  rankScore: number;
  rank: number;
  /** Earliest this resource could start, ISO. */
  earliestAvailableAt?: string;
  /** Safe, non-PII rationale (no chain-of-thought, no PII). */
  rationale: string;
}

/** The proposed service window for the top candidate. */
export interface ProposedWindow {
  /** ISO floor after gating (max of parts ETA, availability, now). */
  earliestStart: string;
  earliestStartBasis: EarliestStartBasis;
  proposedStart?: string; // ISO
  proposedEnd?: string; // ISO
  /** Human window, e.g. "Tomorrow 13:00–15:00 (after parts arrive)". */
  displayWindow?: string;
  durationMinutes?: number;
  windowConfidence: EvidenceConfidence;
  /** True when the window is bounded below by parts ETA, not availability. */
  partsEtaConstrained: boolean;
}

/**
 * The Node 5 state channel and the read model surfaced to the read-only
 * UI. Self-contained and sanitized so the whole channel is safe to
 * persist and render. Sole writer: Node 5.
 */
export interface SchedulingChannel {
  /** Whether the eligibility gate allowed Node 5 to run. */
  eligible: boolean;
  /** Safe reason string (e.g. "Scheduling disabled by config"). */
  eligibilityReason?: string;
  /** True when a Field Service read source was unavailable. */
  degraded: boolean;
  /** Names only of unavailable sources (e.g. ["salesforce_field_service"]). */
  degradedSources?: string[];

  status?: "PLANNED" | "PROVISIONAL" | "DEFERRED" | "UNSCHEDULABLE" | "SKIPPED";
  schedulingReadiness?: SchedulingReadiness;

  /** Ranked candidates (cap small, e.g. top 3). */
  candidates?: TechnicianCandidate[];
  /** Recommended technician = candidates[0]; convenience mirror. */
  recommendedResourceReference?: string;
  proposedWindow?: ProposedWindow;

  /** Parts dependency audit — why scheduling is / isn't gated. */
  partsEtaConsidered: boolean;
  partsReadinessSeen?: "ready" | "partial" | "blocked" | "unknown" | "skipped";

  /** Surfaced for Node 6; 5a never gates the write-back on this. */
  requiredApproval: boolean;
  approvalReason?: SchedulingApprovalReason;

  /** 5c — created ServiceAppointment after approval. Absent until write. */
  appointmentStatus?: "none" | "proposed" | "booked";
  appointmentReference?: string;

  confidence?: EvidenceConfidence;
  provider?: string;
  latencyMs?: number;
}

/** Cheap, config-driven eligibility result (pure, no Salesforce access). */
export interface SchedulingEligibilityResult {
  eligible: boolean;
  /** Safe, non-PII reason string for why eligible=true/false. */
  reason: string;
}
