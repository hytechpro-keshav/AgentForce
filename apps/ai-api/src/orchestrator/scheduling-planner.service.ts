import { Injectable } from "@nestjs/common";

import type {
  SchedulingReadResult,
  SchedulingTechnicianRow
} from "../salesforce/salesforce-scheduling.gateway";
import type { EvidenceConfidence } from "./dto/customer-context";
import type { CustomerContextChannel } from "./dto/customer-context";
import type { PartsLogisticsChannel } from "./dto/parts-logistics";
import type { SalesforceCaseContext } from "./dto/salesforce-case-context";
import type {
  DurationSource,
  EarliestStartBasis,
  ProposedWindow,
  SchedulingApprovalReason,
  SchedulingChannel,
  SchedulingReadiness,
  SlotSource,
  TechnicianCandidate
} from "./dto/scheduling";
import type { AppointmentCandidateSlot } from "../salesforce/salesforce-scheduling.gateway";
import { findEarliestSlot } from "./scheduling-availability";
import {
  RANK_WEIGHTS,
  TERRITORY_FIT_SCORE,
  durationMinutesForSkills,
  reconcileDuration,
  regionForShipTo,
  requiredSkillsForCase,
  slaResponseHours,
  territoryForRegion
} from "./scheduling-rules";
import {
  hhmmInZone,
  tzAbbreviation,
  utcMsToZonedParts
} from "./scheduling-timezone";

const MS_PER_HOUR = 3_600_000;
const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday"
];
/** Availability score reaches 0 when a candidate is this many hours late. */
const AVAILABILITY_DECAY_HOURS = 72;
const MAX_CANDIDATES = 3;

export interface SchedulingPlanInput {
  context: SalesforceCaseContext;
  partsLogistics?: PartsLogisticsChannel;
  customerContext?: CustomerContextChannel;
  triagePriority?: string;
  read: SchedulingReadResult;
  /** Optional typed KB repair-effort hint (minutes) for the duration cross-check (5b). */
  kbDurationMinutesHint?: number;
  /** Injected clock so the planner is deterministic and unit-testable. */
  now: Date;
}

type PartsReadinessSeen = NonNullable<SchedulingChannel["partsReadinessSeen"]>;

interface RankedCandidate extends TechnicianCandidate {
  earliestSlotMs?: number;
  earliestSlotSource?: SlotSource;
}

/**
 * Deterministic, parts-ETA-gated scheduling planner (no LLM, no
 * `AppointmentCandidates` API). For a Case it (1) derives the required
 * skills from the planned parts / case text, (2) derives the target
 * territory from the ship-to region (Node 4 parity), (3) ranks the
 * territory's technicians by skill + territory fit + availability, and
 * (4) proposes the earliest service window that is NOT earlier than parts
 * can arrive: `earliestStart = max(partsEtaFloor, availability, now)`
 * (§3.5).
 *
 * It never throws and never writes to Salesforce — `appointmentStatus`
 * stops at `proposed`. A degraded Field Service read yields a degraded,
 * best-effort channel so the graph continues (B8). Outputs are
 * point-in-time (§3.7): `deferred` / `provisional` reflect parts
 * readiness as of this run only.
 */
@Injectable()
export class SchedulingPlannerService {
  plan(input: SchedulingPlanInput): SchedulingChannel {
    const { context, partsLogistics, customerContext, triagePriority, read } =
      input;
    const nowMs = input.now.getTime();
    const partsReadinessSeen =
      SchedulingPlannerService.partsReadinessOf(partsLogistics);
    const partsEtaConsidered =
      partsLogistics !== undefined && partsLogistics.eligible !== false;

    // B8 — Field Service read failed: degrade, never block the graph.
    if (read.degraded) {
      return {
        eligible: true,
        degraded: true,
        degradedSources: ["salesforce_field_service"],
        status: undefined,
        schedulingReadiness: "unknown",
        partsEtaConsidered,
        partsReadinessSeen,
        requiredApproval: false,
        confidence: "low",
        provider: "deterministic"
      };
    }

    const region = regionForShipTo(context.serviceShipToCountry);
    const territoryName = territoryForRegion(region);
    const requiredSkills = requiredSkillsForCase({
      partNumbers: (partsLogistics?.partPlans ?? []).map((p) => p.partNumber),
      caseText: `${context.subject ?? ""} ${context.description ?? ""}`
    });

    // 5b duration cross-check: reconcile the per-skill default against the
    // live WorkType.EstimatedDuration and any typed KB repair-effort hint.
    const duration = reconcileDuration({
      skillDerivedMinutes: durationMinutesForSkills(requiredSkills),
      workTypeMinutes: SchedulingPlannerService.workTypeMinutesFor(
        requiredSkills,
        read.workTypeDurationMinutesBySkill
      ),
      kbMinutes: input.kbDurationMinutesHint
    });
    const durationMinutes = duration.minutes;

    // Parts-ETA floor: the visit cannot start before the slowest required
    // part can physically arrive (§3.5). `estimatedDispatchHoursMax` is the
    // upper bound of the Node 4 ETA window.
    const partsEtaHours =
      SchedulingPlannerService.partsEtaFloorHours(partsLogistics);
    const partsEtaFloorMs =
      partsEtaHours !== undefined
        ? nowMs + partsEtaHours * MS_PER_HOUR
        : undefined;
    const floorMs = Math.max(partsEtaFloorMs ?? nowMs, nowMs);
    const partsEtaConstrained =
      partsEtaFloorMs !== undefined && partsEtaFloorMs > nowMs;

    const candidates = this.rankCandidates({
      technicians: read.technicians,
      territoryName,
      requiredSkills,
      durationMinutes,
      floorMs,
      businessWindows: read.businessWindows,
      busyIntervals: read.busyIntervals,
      timeZone: read.timeZone,
      appointmentCandidates: read.candidatesApiUsed
        ? read.appointmentCandidates
        : undefined
    });

    // B7 — no eligible technician in the target territory.
    if (candidates.length === 0) {
      return {
        eligible: true,
        degraded: false,
        status: "UNSCHEDULABLE",
        schedulingReadiness: "unschedulable",
        candidates: [],
        partsEtaConsidered,
        partsReadinessSeen,
        requiredApproval: false,
        eligibilityReason: `No active technician with required skills (${requiredSkills.join(
          ", "
        )}) found in territory ${territoryName}.`,
        confidence: "medium",
        provider: "deterministic"
      };
    }

    const top = candidates[0];
    const blocked = partsReadinessSeen === "blocked";
    const readiness = SchedulingPlannerService.readinessFor({
      blocked,
      partsReadinessSeen,
      hasSlot: top.earliestSlotMs !== undefined
    });

    // B6 — parts blocked: rank the technician but commit NO window.
    const proposedWindow = blocked
      ? undefined
      : SchedulingPlannerService.buildWindow({
          top,
          floorMs,
          nowMs,
          partsEtaFloorMs,
          partsEtaConstrained,
          durationMinutes,
          durationSource: duration.source,
          readiness,
          degradedWindows: read.businessWindows.length === 0,
          timeZone: read.timeZone
        });

    const slaHours = slaResponseHours(
      customerContext?.package?.slaClass.value,
      triagePriority
    );
    const approval = SchedulingPlannerService.approvalFor({
      blocked,
      proposedStartMs: proposedWindow?.proposedStart
        ? Date.parse(proposedWindow.proposedStart)
        : undefined,
      slaDeadlineMs: nowMs + slaHours * MS_PER_HOUR
    });

    const confidence = SchedulingPlannerService.confidenceFor(
      readiness,
      proposedWindow
    );

    return {
      eligible: true,
      degraded: false,
      status: SchedulingPlannerService.statusFor(readiness),
      schedulingReadiness: readiness,
      candidates: candidates.map(SchedulingPlannerService.stripInternal),
      recommendedResourceReference: top.resourceReference,
      proposedWindow,
      partsEtaConsidered,
      partsReadinessSeen,
      requiredApproval: approval.requiredApproval,
      approvalReason: approval.reason,
      candidatesApiUsed: read.candidatesApiUsed,
      appointmentStatus: blocked ? "none" : "proposed",
      confidence,
      provider: "deterministic"
    };
  }

  private rankCandidates(args: {
    technicians: SchedulingTechnicianRow[];
    territoryName: string;
    requiredSkills: string[];
    durationMinutes: number;
    floorMs: number;
    businessWindows: SchedulingReadResult["businessWindows"];
    busyIntervals: SchedulingReadResult["busyIntervals"];
    timeZone?: string;
    appointmentCandidates?: AppointmentCandidateSlot[];
  }): RankedCandidate[] {
    const ranked = args.technicians
      .filter((tech) => tech.isActive)
      .map((tech) => this.scoreCandidate(tech, args))
      .filter((c): c is RankedCandidate => c !== undefined);

    ranked.sort((a, b) => {
      if (b.rankScore !== a.rankScore) {
        return b.rankScore - a.rankScore;
      }
      // Deterministic tie-break: earlier availability, then reference.
      const aAvail = a.earliestSlotMs ?? Number.MAX_SAFE_INTEGER;
      const bAvail = b.earliestSlotMs ?? Number.MAX_SAFE_INTEGER;
      if (aAvail !== bAvail) {
        return aAvail - bAvail;
      }
      return a.resourceReference.localeCompare(b.resourceReference);
    });

    return ranked.slice(0, MAX_CANDIDATES).map((candidate, index) => ({
      ...candidate,
      rank: index + 1
    }));
  }

  private scoreCandidate(
    tech: SchedulingTechnicianRow,
    args: {
      territoryName: string;
      requiredSkills: string[];
      durationMinutes: number;
      floorMs: number;
      businessWindows: SchedulingReadResult["businessWindows"];
      busyIntervals: SchedulingReadResult["busyIntervals"];
      timeZone?: string;
      appointmentCandidates?: AppointmentCandidateSlot[];
    }
  ): RankedCandidate | undefined {
    const membership = tech.territories.find(
      (t) => t.name === args.territoryName
    );
    if (!membership) {
      return undefined;
    }
    const membershipKind: "primary" | "secondary" =
      (membership.type ?? "P").toUpperCase() === "P" ? "primary" : "secondary";
    const territoryFitScore = TERRITORY_FIT_SCORE[membershipKind];

    const held = new Map(
      tech.skills.map((s) => [s.label.toLowerCase(), s.level])
    );
    const matchedSkills: string[] = [];
    const missingSkills: string[] = [];
    let levelSum = 0;
    for (const skill of args.requiredSkills) {
      const level = held.get(skill.toLowerCase());
      if (level !== undefined) {
        matchedSkills.push(skill);
        levelSum += level;
      } else {
        missingSkills.push(skill);
      }
    }
    const skillScore =
      args.requiredSkills.length > 0
        ? levelSum / (args.requiredSkills.length * 10)
        : 0;

    const slot = SchedulingPlannerService.earliestSlotFor({
      resourceId: tech.resourceId,
      floorMs: args.floorMs,
      durationMinutes: args.durationMinutes,
      businessWindows: args.businessWindows,
      busyIntervals: args.busyIntervals,
      timeZone: args.timeZone,
      appointmentCandidates: args.appointmentCandidates
    });
    const availabilityScore = slot
      ? SchedulingPlannerService.clamp01(
          1 -
            (slot.startMs - args.floorMs) /
              (AVAILABILITY_DECAY_HOURS * MS_PER_HOUR)
        )
      : 0;

    const rankScore =
      RANK_WEIGHTS.skill * skillScore +
      RANK_WEIGHTS.availability * availabilityScore +
      RANK_WEIGHTS.territory * territoryFitScore;

    return {
      resourceReference: tech.resourceReference,
      territoryReference: args.territoryName,
      territoryMembership: membershipKind,
      matchedSkills,
      missingSkills: missingSkills.length > 0 ? missingSkills : undefined,
      skillScore: round2(skillScore),
      availabilityScore: round2(availabilityScore),
      territoryFitScore: round2(territoryFitScore),
      rankScore: round2(rankScore),
      rank: 0,
      earliestAvailableAt: slot
        ? new Date(slot.startMs).toISOString()
        : undefined,
      earliestSlotMs: slot?.startMs,
      earliestSlotSource: slot?.source,
      rationale: SchedulingPlannerService.candidateRationale({
        matchedSkills,
        missingSkills,
        membershipKind,
        territoryName: args.territoryName,
        hasSlot: Boolean(slot)
      })
    };
  }

  /**
   * Earliest fitting slot for a resource, preferring the native scheduler's
   * AppointmentCandidates when the API was used (5b) and otherwise falling
   * back to the deterministic operating-hours projection. The returned
   * `source` flows to `proposedWindow.slotSource` for explainability.
   */
  private static earliestSlotFor(args: {
    resourceId: string;
    floorMs: number;
    durationMinutes: number;
    businessWindows: SchedulingReadResult["businessWindows"];
    busyIntervals: SchedulingReadResult["busyIntervals"];
    timeZone?: string;
    appointmentCandidates?: AppointmentCandidateSlot[];
  }): { startMs: number; endMs: number; source: SlotSource } | undefined {
    const busy = args.busyIntervals.filter(
      (b) => !b.resourceId || b.resourceId === args.resourceId
    );
    if (args.appointmentCandidates && args.appointmentCandidates.length > 0) {
      const apiSlot = SchedulingPlannerService.earliestApiCandidate(
        args.appointmentCandidates,
        args.resourceId,
        args.floorMs,
        busy
      );
      if (apiSlot) {
        return { ...apiSlot, source: "appointment_candidates" };
      }
    }
    const slot = findEarliestSlot({
      businessWindows: args.businessWindows,
      busyIntervals: busy,
      earliestStartMs: args.floorMs,
      durationMinutes: args.durationMinutes,
      timeZone: args.timeZone
    });
    return slot
      ? { startMs: slot.startMs, endMs: slot.endMs, source: "deterministic" }
      : undefined;
  }

  /** Earliest native-scheduler candidate ≥ floor that does not collide. */
  private static earliestApiCandidate(
    candidates: AppointmentCandidateSlot[],
    resourceId: string,
    floorMs: number,
    busy: SchedulingReadResult["busyIntervals"]
  ): { startMs: number; endMs: number } | undefined {
    const eligible = candidates
      .filter((c) => !c.resourceId || c.resourceId === resourceId)
      .filter((c) => c.startMs >= floorMs && c.endMs > c.startMs)
      .filter(
        (c) => !busy.some((b) => b.startMs < c.endMs && b.endMs > c.startMs)
      )
      .sort((a, b) => a.startMs - b.startMs);
    const first = eligible[0];
    return first ? { startMs: first.startMs, endMs: first.endMs } : undefined;
  }

  /**
   * Largest live WorkType.EstimatedDuration (minutes) among the Case's
   * required skills (5b cross-check). `undefined` when the WorkType read was
   * unavailable so the reconciler falls back to the per-skill default.
   */
  private static workTypeMinutesFor(
    requiredSkills: string[],
    bySkill: Record<string, number> | undefined
  ): number | undefined {
    if (!bySkill) {
      return undefined;
    }
    let max: number | undefined;
    for (const skill of requiredSkills) {
      const minutes = bySkill[skill];
      if (typeof minutes === "number" && minutes > 0) {
        max = max === undefined ? minutes : Math.max(max, minutes);
      }
    }
    return max;
  }

  private static buildWindow(args: {
    top: RankedCandidate;
    floorMs: number;
    nowMs: number;
    partsEtaFloorMs?: number;
    partsEtaConstrained: boolean;
    durationMinutes: number;
    durationSource: DurationSource;
    readiness: SchedulingReadiness;
    degradedWindows: boolean;
    timeZone?: string;
  }): ProposedWindow | undefined {
    const startMs = args.top.earliestSlotMs;
    if (startMs === undefined) {
      // Technician ranked but no concrete slot — surface the floor only.
      return {
        earliestStart: new Date(args.floorMs).toISOString(),
        earliestStartBasis: args.partsEtaConstrained ? "parts_eta" : "now",
        windowConfidence: "low",
        partsEtaConstrained: args.partsEtaConstrained,
        durationMinutes: args.durationMinutes,
        durationSource: args.durationSource,
        timeZone: args.timeZone
      };
    }
    const endMs = startMs + args.durationMinutes * 60_000;
    const basis = SchedulingPlannerService.basisFor({
      startMs,
      floorMs: args.floorMs,
      nowMs: args.nowMs,
      partsEtaFloorMs: args.partsEtaFloorMs
    });
    return {
      earliestStart: new Date(args.floorMs).toISOString(),
      earliestStartBasis: basis,
      proposedStart: new Date(startMs).toISOString(),
      proposedEnd: new Date(endMs).toISOString(),
      displayWindow: SchedulingPlannerService.displayWindow(
        startMs,
        endMs,
        args.nowMs,
        args.partsEtaConstrained,
        args.timeZone
      ),
      durationMinutes: args.durationMinutes,
      durationSource: args.durationSource,
      windowConfidence: SchedulingPlannerService.windowConfidence(
        args.readiness,
        args.degradedWindows
      ),
      partsEtaConstrained: args.partsEtaConstrained,
      timeZone: args.timeZone,
      slotSource: args.top.earliestSlotSource ?? "deterministic"
    };
  }

  private static basisFor(args: {
    startMs: number;
    floorMs: number;
    nowMs: number;
    partsEtaFloorMs?: number;
  }): EarliestStartBasis {
    const partsBound =
      args.partsEtaFloorMs !== undefined && args.partsEtaFloorMs > args.nowMs;
    // Availability pushed the start materially past the floor (> 1h).
    if (args.startMs > args.floorMs + MS_PER_HOUR) {
      return "technician_availability";
    }
    if (partsBound) {
      return "parts_eta";
    }
    return "now";
  }

  private static readinessFor(args: {
    blocked: boolean;
    partsReadinessSeen: PartsReadinessSeen | undefined;
    hasSlot: boolean;
  }): SchedulingReadiness {
    if (args.blocked) {
      return "deferred";
    }
    if (args.partsReadinessSeen === "partial") {
      return "provisional";
    }
    if (args.partsReadinessSeen === "unknown") {
      // Parts read degraded / unknown — best-effort, lower trust.
      return "provisional";
    }
    // ready, skipped (no-parts repair), or no parts dependency.
    return args.hasSlot ? "schedulable" : "provisional";
  }

  private static approvalFor(args: {
    blocked: boolean;
    proposedStartMs?: number;
    slaDeadlineMs: number;
  }): { requiredApproval: boolean; reason: SchedulingApprovalReason } {
    if (args.blocked) {
      return { requiredApproval: true, reason: "parts_not_ready" };
    }
    if (
      args.proposedStartMs !== undefined &&
      args.proposedStartMs > args.slaDeadlineMs
    ) {
      return { requiredApproval: true, reason: "sla_breach_risk" };
    }
    return { requiredApproval: false, reason: "none" };
  }

  private static statusFor(
    readiness: SchedulingReadiness
  ): SchedulingChannel["status"] {
    switch (readiness) {
      case "schedulable":
        return "PLANNED";
      case "provisional":
        return "PROVISIONAL";
      case "deferred":
        return "DEFERRED";
      case "unschedulable":
        return "UNSCHEDULABLE";
      default:
        return "PROVISIONAL";
    }
  }

  private static confidenceFor(
    readiness: SchedulingReadiness,
    window: ProposedWindow | undefined
  ): EvidenceConfidence {
    if (readiness === "schedulable" && window?.proposedStart) {
      return "high";
    }
    if (readiness === "deferred") {
      return "medium";
    }
    return window?.windowConfidence ?? "low";
  }

  private static windowConfidence(
    readiness: SchedulingReadiness,
    degradedWindows: boolean
  ): EvidenceConfidence {
    if (degradedWindows) {
      return "low";
    }
    if (readiness === "schedulable") {
      return "high";
    }
    if (readiness === "provisional") {
      return "medium";
    }
    return "low";
  }

  /** Max upper-bound dispatch hours across required part plans, if any. */
  private static partsEtaFloorHours(
    parts: PartsLogisticsChannel | undefined
  ): number | undefined {
    if (!parts || parts.eligible === false || parts.degraded) {
      return undefined;
    }
    let max: number | undefined;
    for (const plan of parts.partPlans ?? []) {
      const hours = plan.estimatedDispatchHoursMax;
      if (typeof hours === "number" && Number.isFinite(hours)) {
        max = max === undefined ? hours : Math.max(max, hours);
      }
    }
    return max;
  }

  private static partsReadinessOf(
    parts: PartsLogisticsChannel | undefined
  ): PartsReadinessSeen | undefined {
    if (!parts) {
      return undefined;
    }
    if (parts.eligible === false) {
      return "skipped";
    }
    if (parts.degraded) {
      return "unknown";
    }
    switch (parts.fulfillmentReadiness) {
      case "ready":
        return "ready";
      case "partial":
        return "partial";
      case "blocked":
        return "blocked";
      default:
        return "unknown";
    }
  }

  private static displayWindow(
    startMs: number,
    endMs: number,
    nowMs: number,
    partsEtaConstrained: boolean,
    timeZone: string | undefined
  ): string {
    const dayLabel = SchedulingPlannerService.relativeDay(
      startMs,
      nowMs,
      timeZone
    );
    // Render the wall clock in the territory-local zone (UTC when absent).
    const range = `${hhmmInZone(timeZone, startMs)}–${hhmmInZone(
      timeZone,
      endMs
    )} ${tzAbbreviation(timeZone, startMs)}`;
    return `${dayLabel} ${range}${
      partsEtaConstrained ? " (after parts arrive)" : ""
    }`;
  }

  private static relativeDay(
    startMs: number,
    nowMs: number,
    timeZone: string | undefined
  ): string {
    const start = utcMsToZonedParts(timeZone, startMs);
    const now = utcMsToZonedParts(timeZone, nowMs);
    const startDay = Date.UTC(start.year, start.month - 1, start.day);
    const nowDay = Date.UTC(now.year, now.month - 1, now.day);
    const diff = Math.round((startDay - nowDay) / (24 * 60 * 60_000));
    if (diff <= 0) return "Today";
    if (diff === 1) return "Tomorrow";
    return DAY_NAMES[start.weekday];
  }

  private static candidateRationale(args: {
    matchedSkills: string[];
    missingSkills: string[];
    membershipKind: "primary" | "secondary";
    territoryName: string;
    hasSlot: boolean;
  }): string {
    const skillPart =
      args.matchedSkills.length > 0
        ? `matches ${args.matchedSkills.join(", ")}`
        : "no required skill match";
    const missingPart =
      args.missingSkills.length > 0
        ? `; missing ${args.missingSkills.join(", ")}`
        : "";
    const territoryPart = `${args.membershipKind} member of ${args.territoryName}`;
    const availPart = args.hasSlot
      ? "available within the planning horizon"
      : "no open slot in the planning horizon";
    return `${skillPart}${missingPart}; ${territoryPart}; ${availPart}.`;
  }

  /** Drops the internal slot marker before the channel is persisted. */
  private static stripInternal(
    candidate: RankedCandidate
  ): TechnicianCandidate {
    const { earliestSlotMs: _earliestSlotMs, ...rest } = candidate;
    void _earliestSlotMs;
    return rest;
  }

  private static clamp01(value: number): number {
    if (Number.isNaN(value)) return 0;
    return Math.min(1, Math.max(0, value));
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
