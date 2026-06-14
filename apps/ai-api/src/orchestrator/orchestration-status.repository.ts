import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit
} from "@nestjs/common";
import { Pool, type QueryResultRow } from "pg";

import { AppConfigService } from "../config/app-config.service";
import type {
  ApprovalDecision,
  NodeLifecycleStatus,
  OrchestratorNodeId
} from "./dto/case-triage-lifecycle";
import type { CustomerContextChannel } from "./dto/customer-context";
import type { KnowledgeGuidanceChannel } from "./dto/knowledge-guidance";
import type { PartsLogisticsChannel } from "./dto/parts-logistics";
import type {
  CaseTriageWorkflowSnapshot,
  OrchestrationStatusEvent,
  SanitizedTriageResult
} from "./dto/orchestration-status-event";

/**
 * Durable persistence boundary for the Node 1 case-triage read model.
 *
 * This abstract class doubles as the Nest DI token. The in-memory
 * implementation is the default for tests and local dev; the Postgres
 * implementation keeps historical workflows resolvable by Case Id
 * after an ai-api restart or redeploy.
 *
 * It is deliberately separate from the LangGraph checkpointer (which
 * holds execution state for resume). It only stores the sanitized
 * snapshot the read-only UI consumes — never raw Case text, prompts,
 * hidden reasoning, tokens, or secrets.
 */
export abstract class OrchestrationStatusRepository {
  /** Idempotent UPSERT keyed by `workflowId`. Persists the full snapshot. */
  abstract save(snapshot: CaseTriageWorkflowSnapshot): Promise<void>;

  abstract get(
    workflowId: string
  ): Promise<CaseTriageWorkflowSnapshot | undefined>;

  abstract getLatestForCase(
    caseId: string
  ): Promise<CaseTriageWorkflowSnapshot | undefined>;
}

/**
 * Default, dependency-free repository for tests and local dev. Backed
 * by its own `Map`, it deep-clones on save and on read so callers can
 * never mutate stored state. Because it is a standalone instance, a
 * fresh {@link OrchestrationStatusStore} pointed at the SAME repository
 * still resolves prior workflows — which is how the unit tests simulate
 * an ai-api restart.
 */
export class InMemoryOrchestrationStatusRepository extends OrchestrationStatusRepository {
  private readonly workflows = new Map<string, CaseTriageWorkflowSnapshot>();

  async save(snapshot: CaseTriageWorkflowSnapshot): Promise<void> {
    this.workflows.set(snapshot.workflowId, structuredClone(snapshot));
  }

  async get(
    workflowId: string
  ): Promise<CaseTriageWorkflowSnapshot | undefined> {
    const snapshot = this.workflows.get(workflowId);
    return snapshot ? structuredClone(snapshot) : undefined;
  }

  async getLatestForCase(
    caseId: string
  ): Promise<CaseTriageWorkflowSnapshot | undefined> {
    const normalizedCaseId = caseId.trim();
    const matches = Array.from(this.workflows.values()).filter(
      (snapshot) => snapshot.caseId === normalizedCaseId
    );
    if (matches.length === 0) {
      return undefined;
    }
    matches.sort((a, b) => {
      if (a.updatedAt !== b.updatedAt) {
        return a.updatedAt < b.updatedAt ? 1 : -1;
      }
      if (a.createdAt !== b.createdAt) {
        return a.createdAt < b.createdAt ? 1 : -1;
      }
      return 0;
    });
    return structuredClone(matches[0]);
  }
}

interface OrchestrationWorkflowRow extends QueryResultRow {
  workflow_id: string;
  case_id: string;
  case_number: string | null;
  node: string;
  status: string;
  approval_required: boolean;
  approval_decision: string | null;
  write_back_applied: boolean;
  failure_kind: string | null;
  triage: unknown;
  customer_context: unknown;
  knowledge_guidance: unknown;
  parts_logistics: unknown;
  events: unknown;
  created_at: Date | string;
  updated_at: Date | string;
}

/**
 * Postgres-backed durable repository. Mirrors the canonical pattern in
 * {@link TenantRegistryService}: a lazy pool created in
 * `onModuleInit` only when the orchestrator persistence provider is
 * `postgres`, a `migrate()` wrapped in BEGIN/COMMIT/ROLLBACK with
 * `CREATE TABLE IF NOT EXISTS`, and `pool.end()` on destroy.
 */
@Injectable()
export class PostgresOrchestrationStatusRepository
  extends OrchestrationStatusRepository
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(
    PostgresOrchestrationStatusRepository.name
  );
  private pool?: Pool;

  constructor(private readonly config: AppConfigService) {
    super();
  }

  async onModuleInit(): Promise<void> {
    const persistence = this.config.orchestrator.persistence;
    if (persistence.provider !== "postgres") {
      return;
    }
    // Idempotent: a re-entrant init (or a double lifecycle dispatch)
    // must not create a second pool.
    if (this.pool) {
      return;
    }

    this.pool = new Pool({
      connectionString: persistence.databaseUrl,
      max: persistence.maxPoolSize,
      ...(persistence.ssl ? { ssl: { rejectUnauthorized: false } } : {})
    });

    if (persistence.autoMigrate) {
      await this.migrate();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
    this.pool = undefined;
  }

  async save(snapshot: CaseTriageWorkflowSnapshot): Promise<void> {
    try {
      await this.requirePool().query(
        `
          INSERT INTO ai_api_orchestration_workflows (
            workflow_id,
            case_id,
            case_number,
            node,
            status,
            approval_required,
            approval_decision,
            write_back_applied,
            failure_kind,
            triage,
            customer_context,
            knowledge_guidance,
            parts_logistics,
            events,
            created_at,
            updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb, $15, $16
          )
          ON CONFLICT (workflow_id) DO UPDATE SET
            case_id = EXCLUDED.case_id,
            case_number = EXCLUDED.case_number,
            node = EXCLUDED.node,
            status = EXCLUDED.status,
            approval_required = EXCLUDED.approval_required,
            approval_decision = EXCLUDED.approval_decision,
            write_back_applied = EXCLUDED.write_back_applied,
            failure_kind = EXCLUDED.failure_kind,
            triage = EXCLUDED.triage,
            customer_context = EXCLUDED.customer_context,
            knowledge_guidance = EXCLUDED.knowledge_guidance,
            parts_logistics = EXCLUDED.parts_logistics,
            events = EXCLUDED.events,
            created_at = EXCLUDED.created_at,
            updated_at = EXCLUDED.updated_at
        `,
        [
          snapshot.workflowId,
          snapshot.caseId,
          snapshot.caseNumber ?? null,
          snapshot.node,
          snapshot.status,
          snapshot.approvalRequired,
          snapshot.approvalDecision ?? null,
          snapshot.writeBackApplied,
          snapshot.failureKind ?? null,
          snapshot.triage ? JSON.stringify(snapshot.triage) : null,
          snapshot.customerContext
            ? JSON.stringify(snapshot.customerContext)
            : null,
          snapshot.knowledgeGuidance
            ? JSON.stringify(snapshot.knowledgeGuidance)
            : null,
          snapshot.partsLogistics
            ? JSON.stringify(snapshot.partsLogistics)
            : null,
          JSON.stringify(snapshot.events ?? []),
          snapshot.createdAt,
          snapshot.updatedAt
        ]
      );
    } catch (err) {
      // Safe warning only (no connection string, no Case text, no PII).
      // Rethrow so the store's best-effort catch records the miss and
      // keeps the in-memory snapshot authoritative for this instance.
      this.logger.warn(
        `Orchestration workflow persist failed: ${(err as Error).name}`
      );
      throw err;
    }
  }

  async get(
    workflowId: string
  ): Promise<CaseTriageWorkflowSnapshot | undefined> {
    const result = await this.requirePool().query<OrchestrationWorkflowRow>(
      `
        SELECT * FROM ai_api_orchestration_workflows
        WHERE workflow_id = $1
        LIMIT 1
      `,
      [workflowId]
    );
    const row = result.rows[0];
    return row ? PostgresOrchestrationStatusRepository.mapRow(row) : undefined;
  }

  async getLatestForCase(
    caseId: string
  ): Promise<CaseTriageWorkflowSnapshot | undefined> {
    const result = await this.requirePool().query<OrchestrationWorkflowRow>(
      `
        SELECT * FROM ai_api_orchestration_workflows
        WHERE case_id = $1
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1
      `,
      [caseId.trim()]
    );
    const row = result.rows[0];
    return row ? PostgresOrchestrationStatusRepository.mapRow(row) : undefined;
  }

  private requirePool(): Pool {
    if (!this.pool) {
      throw new Error("Orchestration status Postgres pool is not initialized.");
    }
    return this.pool;
  }

  private async migrate(): Promise<void> {
    const pool = this.requirePool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`
        CREATE TABLE IF NOT EXISTS ai_api_orchestration_workflows (
          workflow_id text PRIMARY KEY,
          case_id text NOT NULL,
          case_number text,
          node text NOT NULL,
          status text NOT NULL,
          approval_required boolean NOT NULL DEFAULT false,
          approval_decision text,
          write_back_applied boolean NOT NULL DEFAULT false,
          failure_kind text,
          triage jsonb,
          customer_context jsonb,
          knowledge_guidance jsonb,
          parts_logistics jsonb,
          events jsonb NOT NULL DEFAULT '[]'::jsonb,
          created_at timestamptz NOT NULL,
          updated_at timestamptz NOT NULL
        )
      `);
      await client.query(`
        ALTER TABLE ai_api_orchestration_workflows
        ADD COLUMN IF NOT EXISTS knowledge_guidance jsonb
      `);
      await client.query(`
        ALTER TABLE ai_api_orchestration_workflows
        ADD COLUMN IF NOT EXISTS parts_logistics jsonb
      `);
      await client.query(
        "CREATE INDEX IF NOT EXISTS ai_api_orchestration_workflows_case_idx ON ai_api_orchestration_workflows(case_id)"
      );
      await client.query(
        "CREATE INDEX IF NOT EXISTS ai_api_orchestration_workflows_case_updated_idx ON ai_api_orchestration_workflows(case_id, updated_at DESC)"
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  private static mapRow(
    row: OrchestrationWorkflowRow
  ): CaseTriageWorkflowSnapshot {
    return {
      workflowId: row.workflow_id,
      caseId: row.case_id,
      caseNumber: row.case_number ?? undefined,
      node: row.node as OrchestratorNodeId,
      status: row.status as NodeLifecycleStatus,
      approvalRequired: row.approval_required,
      approvalDecision:
        (row.approval_decision as ApprovalDecision | null) ?? undefined,
      writeBackApplied: row.write_back_applied,
      failureKind: row.failure_kind ?? undefined,
      triage: PostgresOrchestrationStatusRepository.parseTriage(row.triage),
      customerContext:
        PostgresOrchestrationStatusRepository.parseCustomerContext(
          row.customer_context
        ),
      knowledgeGuidance:
        PostgresOrchestrationStatusRepository.parseKnowledgeGuidance(
          row.knowledge_guidance
        ),
      partsLogistics: PostgresOrchestrationStatusRepository.parsePartsLogistics(
        row.parts_logistics
      ),
      createdAt: PostgresOrchestrationStatusRepository.toIso(row.created_at),
      updatedAt: PostgresOrchestrationStatusRepository.toIso(row.updated_at),
      events: PostgresOrchestrationStatusRepository.parseEvents(row.events)
    };
  }

  private static parseEvents(value: unknown): OrchestrationStatusEvent[] {
    if (Array.isArray(value)) {
      return value as OrchestrationStatusEvent[];
    }
    if (typeof value === "string") {
      try {
        const parsed: unknown = JSON.parse(value);
        return Array.isArray(parsed)
          ? (parsed as OrchestrationStatusEvent[])
          : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  private static parseTriage(
    value: unknown
  ): SanitizedTriageResult | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }
    if (typeof value === "string") {
      try {
        return JSON.parse(value) as SanitizedTriageResult;
      } catch {
        return undefined;
      }
    }
    return value as SanitizedTriageResult;
  }

  private static parseCustomerContext(
    value: unknown
  ): CustomerContextChannel | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }
    if (typeof value === "string") {
      try {
        return JSON.parse(value) as CustomerContextChannel;
      } catch {
        return undefined;
      }
    }
    return value as CustomerContextChannel;
  }

  private static parseKnowledgeGuidance(
    value: unknown
  ): KnowledgeGuidanceChannel | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }
    if (typeof value === "string") {
      try {
        return JSON.parse(value) as KnowledgeGuidanceChannel;
      } catch {
        return undefined;
      }
    }
    return value as KnowledgeGuidanceChannel;
  }

  private static parsePartsLogistics(
    value: unknown
  ): PartsLogisticsChannel | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }
    if (typeof value === "string") {
      try {
        return JSON.parse(value) as PartsLogisticsChannel;
      } catch {
        return undefined;
      }
    }
    return value as PartsLogisticsChannel;
  }

  private static toIso(value: Date | string): string {
    if (value instanceof Date) {
      return value.toISOString();
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? String(value)
      : parsed.toISOString();
  }
}
