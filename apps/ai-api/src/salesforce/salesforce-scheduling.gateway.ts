import { Injectable, Logger } from "@nestjs/common";

import { AppConfigService } from "../config/app-config.service";
import type {
  BusinessWindow,
  BusyInterval
} from "../orchestrator/scheduling-availability";
import { SalesforceAuthService } from "./salesforce-auth.service";
import { SalesforceGatewayError } from "./salesforce-gateway.error";
import { fetchWithTimeout, readJsonObject } from "./salesforce-http.util";

/** DayOfWeek picklist (TimeSlot) → Date.getUTCDay index. */
const DAY_OF_WEEK_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6
};

/** A technician candidate, already sanitized at the read boundary. */
export interface SchedulingTechnicianRow {
  /**
   * Internal Salesforce id — used ONLY to match per-resource absences. It
   * is never surfaced to the `scheduling` channel or status events.
   */
  resourceId: string;
  /**
   * Stable, non-PII reference derived from `ServiceResource.Name` (e.g.
   * "SR-A1"). The full technician name NEVER leaves this gateway (§R3).
   */
  resourceReference: string;
  isActive: boolean;
  /** Memberships for the target territory only (Primary `P` / Secondary `S`). */
  territories: Array<{ name: string; type: string }>;
  skills: Array<{ label: string; level: number }>;
}

export interface SchedulingReadResult {
  /** Read source: "soql" when live, "none" when not configured/empty. */
  source: "soql" | "none";
  technicians: SchedulingTechnicianRow[];
  /** Territory operating-hours windows (weekly, UTC v1). */
  businessWindows: BusinessWindow[];
  /** Per-resource busy intervals from `ResourceAbsence`. */
  busyIntervals: Array<BusyInterval & { resourceId?: string }>;
  /** True when the critical technician read could not complete. */
  degraded: boolean;
}

export interface SchedulingReadInput {
  territoryName: string;
  /** Look-ahead window for busy intervals (ISO). */
  windowStartIso: string;
  windowEndIso: string;
}

/**
 * Node 5 read-only Field Service gateway — the single seam where the
 * scheduling planner reads technicians, skills, territory membership, and
 * availability from Salesforce. Like the Node 4 inventory gateway it has
 * NO write methods (`ServiceAppointment` create is Phase 5c).
 *
 * Sanitization happens at the boundary: `ServiceResource.Name` is reduced
 * to a non-PII `resourceReference` here, so no full technician name can
 * ever reach the planner, the channel, or a status event. A read failure
 * degrades the plan (`degraded: true`) rather than throwing, so Node 5
 * can never break the graph (§8.4 step 8 / B8).
 */
@Injectable()
export class SalesforceSchedulingGateway {
  private readonly logger = new Logger(SalesforceSchedulingGateway.name);

  constructor(
    private readonly auth: SalesforceAuthService,
    private readonly config: AppConfigService
  ) {}

  isConfigured(): boolean {
    return this.config.salesforceConnection.enabled;
  }

  /**
   * Reads the technicians (with territory membership + skills) for the
   * target territory, the territory operating-hours windows, and per-
   * resource absences. The technician read is critical — its failure
   * degrades the whole result. Operating-hours and absence reads are
   * best-effort: a miss leaves those signals empty without degrading the
   * technician ranking.
   */
  async readSchedulingContext(
    input: SchedulingReadInput
  ): Promise<SchedulingReadResult> {
    const territory = (input.territoryName ?? "").trim();
    if (!territory) {
      return this.emptyResult("none", false);
    }

    let technicians: SchedulingTechnicianRow[];
    try {
      technicians = await this.readTechnicians(territory);
    } catch (err) {
      const kind =
        err instanceof SalesforceGatewayError ? err.kind : "unexpected";
      this.logger.warn(`Scheduling technician read degraded: kind=${kind}`);
      return this.emptyResult("none", true);
    }

    // Availability signals are best-effort — a miss must not degrade the
    // ranked-candidate result, only soften the proposed window.
    const businessWindows = await this.readBusinessWindowsSafe(territory);
    const busyIntervals = await this.readAbsencesSafe(
      input.windowStartIso,
      input.windowEndIso
    );

    return {
      source: "soql",
      technicians,
      businessWindows,
      busyIntervals,
      degraded: false
    };
  }

  private async readTechnicians(
    territory: string
  ): Promise<SchedulingTechnicianRow[]> {
    const quoted = SalesforceSchedulingGateway.soqlString(territory);
    // Semi-join keeps the read bulk-safe (members of the target territory
    // only); the subqueries carry the membership type and skill levels the
    // planner ranks on. Secondary (`S`) members are included — A1/A2 are
    // Secondary in North America (§8.3).
    const soql =
      "SELECT Id, Name, ResourceType, IsActive, " +
      "(SELECT ServiceTerritory.Name, TerritoryType FROM ServiceTerritories " +
      `WHERE ServiceTerritory.Name = ${quoted}), ` +
      "(SELECT Skill.MasterLabel, SkillLevel FROM ServiceResourceSkills) " +
      "FROM ServiceResource " +
      "WHERE IsActive = true AND ResourceType = 'T' " +
      "AND Id IN (SELECT ServiceResourceId FROM ServiceTerritoryMember " +
      `WHERE ServiceTerritory.Name = ${quoted})`;
    const records = await this.runQuery(soql);
    return records
      .map((row, index) =>
        SalesforceSchedulingGateway.mapTechnician(row, index)
      )
      .filter((row): row is SchedulingTechnicianRow => row !== undefined);
  }

  private async readBusinessWindowsSafe(
    territory: string
  ): Promise<BusinessWindow[]> {
    try {
      const quoted = SalesforceSchedulingGateway.soqlString(territory);
      const soql =
        "SELECT Id, (SELECT DayOfWeek, StartTime, EndTime, Type FROM TimeSlots) " +
        "FROM OperatingHours WHERE Id IN " +
        `(SELECT OperatingHoursId FROM ServiceTerritory WHERE Name = ${quoted})`;
      const records = await this.runQuery(soql);
      const windows: BusinessWindow[] = [];
      for (const oh of records) {
        const timeSlots = SalesforceSchedulingGateway.childRecords(
          oh,
          "TimeSlots"
        );
        for (const slot of timeSlots) {
          const window = SalesforceSchedulingGateway.mapTimeSlot(slot);
          if (window) {
            windows.push(window);
          }
        }
      }
      return windows;
    } catch {
      this.logger.warn("Scheduling operating-hours read unavailable.");
      return [];
    }
  }

  private async readAbsencesSafe(
    windowStartIso: string,
    windowEndIso: string
  ): Promise<Array<BusyInterval & { resourceId?: string }>> {
    const start = SalesforceSchedulingGateway.soqlDateTime(windowStartIso);
    const end = SalesforceSchedulingGateway.soqlDateTime(windowEndIso);
    if (!start || !end) {
      return [];
    }
    try {
      const soql =
        "SELECT ResourceId, Start, End FROM ResourceAbsence " +
        `WHERE Start <= ${end} AND End >= ${start}`;
      const records = await this.runQuery(soql);
      const intervals: Array<BusyInterval & { resourceId?: string }> = [];
      for (const row of records) {
        const startMs = SalesforceSchedulingGateway.isoToMs(
          SalesforceSchedulingGateway.str(row, "Start")
        );
        const endMs = SalesforceSchedulingGateway.isoToMs(
          SalesforceSchedulingGateway.str(row, "End")
        );
        if (startMs === undefined || endMs === undefined || endMs <= startMs) {
          continue;
        }
        intervals.push({
          startMs,
          endMs,
          resourceId: SalesforceSchedulingGateway.str(row, "ResourceId")
        });
      }
      return intervals;
    } catch {
      this.logger.warn("Scheduling absence read unavailable.");
      return [];
    }
  }

  private async runQuery(
    soql: string
  ): Promise<Array<Record<string, unknown>>> {
    const path = `/services/data/v${this.apiVersion()}/query?q=${encodeURIComponent(
      soql
    )}`;
    const response = await this.authedRequest("GET", path);
    this.assertOk(response);
    const json = await readJsonObject(response);
    const records = json["records"];
    return Array.isArray(records)
      ? (records as Array<Record<string, unknown>>)
      : [];
  }

  private apiVersion(): string {
    return this.config.salesforceConnection.apiVersion;
  }

  /** GET with a single 401 retry after invalidating the cached token. */
  private async authedRequest(method: "GET", path: string): Promise<Response> {
    const attempt = async (): Promise<Response> => {
      const { accessToken, instanceUrl } = await this.auth.getAccessContext();
      return fetchWithTimeout(
        `${instanceUrl}${path}`,
        {
          method,
          headers: {
            authorization: `Bearer ${accessToken}`,
            accept: "application/json"
          }
        },
        this.config.salesforceConnection.timeoutMs
      );
    };

    const first = await attempt();
    if (first.status !== 401) {
      return first;
    }
    this.auth.invalidate();
    return attempt();
  }

  private assertOk(response: Response): void {
    if (response.status >= 200 && response.status < 300) {
      return;
    }
    if (response.status === 401 || response.status === 403) {
      throw new SalesforceGatewayError(
        "auth",
        "Salesforce rejected the scheduling-read credentials."
      );
    }
    if (response.status === 404) {
      throw new SalesforceGatewayError(
        "not_found",
        "Salesforce scheduling object not found."
      );
    }
    this.logger.warn(
      `Salesforce scheduling read failed (status=${response.status}).`
    );
    throw new SalesforceGatewayError(
      "backend",
      "Salesforce returned an error for the scheduling read."
    );
  }

  private emptyResult(
    source: "soql" | "none",
    degraded: boolean
  ): SchedulingReadResult {
    return {
      source,
      technicians: [],
      businessWindows: [],
      busyIntervals: [],
      degraded
    };
  }

  private static mapTechnician(
    row: Record<string, unknown>,
    index: number
  ): SchedulingTechnicianRow | undefined {
    const resourceId = SalesforceSchedulingGateway.str(row, "Id");
    const name = SalesforceSchedulingGateway.str(row, "Name");
    if (!resourceId || !name) {
      return undefined;
    }
    const territories = SalesforceSchedulingGateway.childRecords(
      row,
      "ServiceTerritories"
    )
      .map((member) => {
        const territory =
          member["ServiceTerritory"] &&
          typeof member["ServiceTerritory"] === "object"
            ? (member["ServiceTerritory"] as Record<string, unknown>)
            : undefined;
        const territoryName = SalesforceSchedulingGateway.str(
          territory,
          "Name"
        );
        const type = SalesforceSchedulingGateway.str(member, "TerritoryType");
        return territoryName
          ? { name: territoryName, type: type ?? "P" }
          : undefined;
      })
      .filter((t): t is { name: string; type: string } => t !== undefined);
    const skills = SalesforceSchedulingGateway.childRecords(
      row,
      "ServiceResourceSkills"
    )
      .map((srs) => {
        const skill =
          srs["Skill"] && typeof srs["Skill"] === "object"
            ? (srs["Skill"] as Record<string, unknown>)
            : undefined;
        const label = SalesforceSchedulingGateway.str(skill, "MasterLabel");
        const level = SalesforceSchedulingGateway.num(srs, "SkillLevel");
        return label ? { label, level } : undefined;
      })
      .filter((s): s is { label: string; level: number } => s !== undefined);
    return {
      resourceId,
      resourceReference: SalesforceSchedulingGateway.sanitizeReference(
        name,
        index
      ),
      isActive: SalesforceSchedulingGateway.bool(row, "IsActive"),
      territories,
      skills
    };
  }

  private static mapTimeSlot(
    slot: Record<string, unknown>
  ): BusinessWindow | undefined {
    const type = SalesforceSchedulingGateway.str(slot, "Type");
    // Only standard operating windows feed availability; extended/on-call
    // slots are ignored in v1.
    if (type && type.toLowerCase() !== "normal") {
      return undefined;
    }
    const dayRaw = SalesforceSchedulingGateway.str(slot, "DayOfWeek");
    if (!dayRaw) {
      return undefined;
    }
    const dayOfWeek = DAY_OF_WEEK_INDEX[dayRaw.trim().toLowerCase()];
    const openMinutes = SalesforceSchedulingGateway.timeToMinutes(
      slot["StartTime"]
    );
    const closeMinutes = SalesforceSchedulingGateway.timeToMinutes(
      slot["EndTime"]
    );
    if (
      dayOfWeek === undefined ||
      openMinutes === undefined ||
      closeMinutes === undefined ||
      closeMinutes <= openMinutes
    ) {
      return undefined;
    }
    return { dayOfWeek, openMinutes, closeMinutes };
  }

  /**
   * Derives a stable, non-PII reference from a technician name. A leading
   * code-like token (e.g. "A1") becomes "SR-A1"; otherwise initials (e.g.
   * "A.R."); otherwise a positional fallback. The full name is discarded.
   */
  private static sanitizeReference(name: string, index: number): string {
    const tokens = name.trim().split(/\s+/).filter(Boolean);
    const first = tokens[0] ?? "";
    if (/^[A-Za-z]{1,4}\d{1,4}$/.test(first)) {
      return `SR-${first.toUpperCase()}`;
    }
    const initials = tokens
      .slice(0, 3)
      .map((token) => token[0]?.toUpperCase())
      .filter(Boolean)
      .join(".");
    if (initials.length >= 2) {
      return `${initials}.`;
    }
    return `SR-${index + 1}`;
  }

  private static childRecords(
    row: Record<string, unknown>,
    relationship: string
  ): Array<Record<string, unknown>> {
    const child = row[relationship];
    if (!child || typeof child !== "object") {
      return [];
    }
    const records = (child as Record<string, unknown>)["records"];
    return Array.isArray(records)
      ? (records as Array<Record<string, unknown>>)
      : [];
  }

  /** Parses a Salesforce Time field (string "HH:mm:ss…" or ms number). */
  private static timeToMinutes(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) {
      // Time fields can serialize as milliseconds from midnight.
      return Math.floor(value / 60_000);
    }
    if (typeof value === "string") {
      const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
      if (match) {
        const hours = Number(match[1]);
        const minutes = Number(match[2]);
        if (hours >= 0 && hours <= 24 && minutes >= 0 && minutes < 60) {
          return hours * 60 + minutes;
        }
      }
    }
    return undefined;
  }

  private static isoToMs(value: string | undefined): number | undefined {
    if (!value) return undefined;
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? undefined : ms;
  }

  /** Quote + escape a string for safe inline use in a SOQL literal. */
  private static soqlString(value: string): string {
    return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  }

  /** Validate + pass through an ISO datetime as an unquoted SOQL literal. */
  private static soqlDateTime(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
  }

  private static str(
    row: Record<string, unknown> | undefined,
    key: string
  ): string | undefined {
    if (!row) return undefined;
    const value = row[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  }

  private static num(
    row: Record<string, unknown> | undefined,
    key: string
  ): number {
    if (!row) return 0;
    const value = row[key];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  }

  private static bool(
    row: Record<string, unknown> | undefined,
    key: string
  ): boolean {
    return Boolean(row?.[key]);
  }
}
