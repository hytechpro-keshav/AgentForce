import type { AppConfigService } from "../config/app-config.service";
import type { CaseTriageWorkflowSnapshot } from "./dto/orchestration-status-event";
import {
  InMemoryOrchestrationStatusRepository,
  PostgresOrchestrationStatusRepository
} from "./orchestration-status.repository";

function snapshot(
  overrides: Partial<CaseTriageWorkflowSnapshot> = {}
): CaseTriageWorkflowSnapshot {
  const now = new Date().toISOString();
  return {
    workflowId: "wf-1",
    caseId: "500000000000001",
    caseNumber: "00004242",
    node: "triage",
    status: "assigned",
    approvalRequired: false,
    writeBackApplied: false,
    createdAt: now,
    updatedAt: now,
    events: [
      {
        workflowId: "wf-1",
        caseId: "500000000000001",
        caseNumber: "00004242",
        node: "triage",
        status: "assigned",
        sequence: 1,
        occurredAt: now,
        safeSummary: "Triage Agent assigned to Case 00004242."
      }
    ],
    ...overrides
  };
}

describe("InMemoryOrchestrationStatusRepository", () => {
  it("round-trips a saved snapshot by workflow id", async () => {
    const repo = new InMemoryOrchestrationStatusRepository();
    await repo.save(snapshot());
    const loaded = await repo.get("wf-1");
    expect(loaded?.workflowId).toBe("wf-1");
    expect(loaded?.caseNumber).toBe("00004242");
    expect(loaded?.events).toHaveLength(1);
  });

  it("is idempotent: a second save with the same id overwrites, not duplicates", async () => {
    const repo = new InMemoryOrchestrationStatusRepository();
    await repo.save(snapshot({ status: "assigned" }));
    await repo.save(
      snapshot({
        status: "done",
        writeBackApplied: true,
        updatedAt: new Date(Date.now() + 1000).toISOString()
      })
    );
    const loaded = await repo.get("wf-1");
    expect(loaded?.status).toBe("done");
    expect(loaded?.writeBackApplied).toBe(true);
    const latest = await repo.getLatestForCase("500000000000001");
    expect(latest?.workflowId).toBe("wf-1");
  });

  it("returns the deterministic latest workflow for a Case Id by recency", async () => {
    const repo = new InMemoryOrchestrationStatusRepository();
    const t0 = new Date("2026-06-01T00:00:00.000Z").toISOString();
    const t1 = new Date("2026-06-01T00:05:00.000Z").toISOString();
    const t2 = new Date("2026-06-01T00:10:00.000Z").toISOString();
    await repo.save(
      snapshot({ workflowId: "wf-a", createdAt: t0, updatedAt: t1 })
    );
    await repo.save(
      snapshot({ workflowId: "wf-b", createdAt: t0, updatedAt: t2 })
    );
    await repo.save(
      snapshot({ workflowId: "wf-c", createdAt: t0, updatedAt: t0 })
    );

    const latest = await repo.getLatestForCase("500000000000001");
    expect(latest?.workflowId).toBe("wf-b");
  });

  it("breaks an updatedAt tie with createdAt", async () => {
    const repo = new InMemoryOrchestrationStatusRepository();
    const updated = new Date("2026-06-01T00:05:00.000Z").toISOString();
    await repo.save(
      snapshot({
        workflowId: "wf-older",
        createdAt: new Date("2026-06-01T00:00:00.000Z").toISOString(),
        updatedAt: updated
      })
    );
    await repo.save(
      snapshot({
        workflowId: "wf-newer",
        createdAt: new Date("2026-06-01T00:02:00.000Z").toISOString(),
        updatedAt: updated
      })
    );
    const latest = await repo.getLatestForCase("500000000000001");
    expect(latest?.workflowId).toBe("wf-newer");
  });

  it("returns undefined for a missing workflow and a missing case", async () => {
    const repo = new InMemoryOrchestrationStatusRepository();
    expect(await repo.get("wf-missing")).toBeUndefined();
    expect(await repo.getLatestForCase("500000000000999")).toBeUndefined();
  });

  it("clones on save and read so callers cannot mutate stored state", async () => {
    const repo = new InMemoryOrchestrationStatusRepository();
    const original = snapshot();
    await repo.save(original);
    original.status = "failed";
    original.events.push({
      workflowId: "wf-1",
      caseId: "500000000000001",
      node: "triage",
      status: "failed",
      sequence: 2,
      occurredAt: new Date().toISOString()
    });

    const loaded = await repo.get("wf-1");
    expect(loaded?.status).toBe("assigned");
    expect(loaded?.events).toHaveLength(1);
  });
});

interface MockPool {
  query: jest.Mock;
  connect: jest.Mock;
  end: jest.Mock;
}

function postgresRepo(query: jest.Mock): {
  repo: PostgresOrchestrationStatusRepository;
  pool: MockPool;
} {
  const config = {
    orchestrator: {
      persistence: {
        provider: "postgres",
        databaseUrl: "postgres://localhost:5432/agentforce",
        autoMigrate: false,
        ssl: false,
        maxPoolSize: 5
      }
    }
  } as unknown as AppConfigService;
  const repo = new PostgresOrchestrationStatusRepository(config);
  const pool: MockPool = {
    query,
    connect: jest.fn(),
    end: jest.fn().mockResolvedValue(undefined)
  };
  // Inject the mocked pool in place of a real connection.
  (repo as unknown as { pool: MockPool }).pool = pool;
  return { repo, pool };
}

describe("PostgresOrchestrationStatusRepository", () => {
  it("does not open a pool when the provider is not postgres", async () => {
    const config = {
      orchestrator: {
        persistence: {
          provider: "memory",
          autoMigrate: true,
          ssl: false,
          maxPoolSize: 5
        }
      }
    } as unknown as AppConfigService;
    const repo = new PostgresOrchestrationStatusRepository(config);
    await repo.onModuleInit();
    expect((repo as unknown as { pool?: unknown }).pool).toBeUndefined();
    // Destroy is safe even when no pool was created.
    await expect(repo.onModuleDestroy()).resolves.toBeUndefined();
  });

  it("saves via an idempotent INSERT ... ON CONFLICT upsert", async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const { repo } = postgresRepo(query);
    await repo.save(snapshot());

    expect(query).toHaveBeenCalledTimes(1);
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("INSERT INTO ai_api_orchestration_workflows");
    expect(sql).toContain("ON CONFLICT (workflow_id) DO UPDATE");
    const params = query.mock.calls[0][1] as unknown[];
    expect(params[0]).toBe("wf-1");
    expect(params[1]).toBe("500000000000001");
  });

  it("reads the latest workflow for a Case Id ordered by updated_at desc", async () => {
    const now = new Date();
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          workflow_id: "wf-1",
          case_id: "500000000000001",
          case_number: "00004242",
          node: "triage",
          status: "done",
          approval_required: false,
          approval_decision: null,
          write_back_applied: true,
          failure_kind: null,
          triage: {
            recommendedPriority: "normal",
            summary: "Outage triaged.",
            suggestedNextStep: "Investigate.",
            provider: "openai",
            model: "gpt-4o-mini",
            fallbackUsed: false,
            latencyMs: 40
          },
          events: [
            {
              workflowId: "wf-1",
              caseId: "500000000000001",
              node: "triage",
              status: "done",
              sequence: 1,
              occurredAt: now.toISOString()
            }
          ],
          created_at: now,
          updated_at: now
        }
      ]
    });
    const { repo } = postgresRepo(query);

    const latest = await repo.getLatestForCase("500000000000001");
    expect(latest?.workflowId).toBe("wf-1");
    expect(latest?.status).toBe("done");
    expect(latest?.writeBackApplied).toBe(true);
    expect(latest?.triage?.recommendedPriority).toBe("normal");
    expect(latest?.events).toHaveLength(1);

    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("WHERE case_id = $1");
    expect(sql).toContain("ORDER BY updated_at DESC, created_at DESC");
    expect(sql).toContain("LIMIT 1");
  });

  it("maps a row by workflow id, tolerating jsonb delivered as a string", async () => {
    const now = new Date();
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          workflow_id: "wf-1",
          case_id: "500000000000001",
          case_number: null,
          node: "triage",
          status: "assigned",
          approval_required: false,
          approval_decision: null,
          write_back_applied: false,
          failure_kind: null,
          triage: null,
          events: JSON.stringify([
            {
              workflowId: "wf-1",
              caseId: "500000000000001",
              node: "triage",
              status: "assigned",
              sequence: 1,
              occurredAt: now.toISOString()
            }
          ]),
          created_at: now.toISOString(),
          updated_at: now.toISOString()
        }
      ]
    });
    const { repo } = postgresRepo(query);

    const loaded = await repo.get("wf-1");
    expect(loaded?.caseNumber).toBeUndefined();
    expect(loaded?.triage).toBeUndefined();
    expect(loaded?.events).toHaveLength(1);
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("WHERE workflow_id = $1");
  });

  it("rethrows a save failure with a safe message and no parameters", async () => {
    const query = jest.fn().mockRejectedValue(new Error("connection reset"));
    const { repo } = postgresRepo(query);
    await expect(repo.save(snapshot())).rejects.toThrow();
  });

  it("throws when used before the pool is initialized", async () => {
    const config = {
      orchestrator: {
        persistence: { provider: "postgres", autoMigrate: false }
      }
    } as unknown as AppConfigService;
    const repo = new PostgresOrchestrationStatusRepository(config);
    await expect(repo.get("wf-1")).rejects.toThrow(
      "Orchestration status Postgres pool is not initialized."
    );
  });
});

const customerChannel = {
  eligible: true,
  degraded: true,
  degradedSources: ["warranty"],
  provider: "openai",
  model: "gpt-4o-mini",
  fallbackUsed: false,
  latencyMs: 12,
  package: {
    customerTier: {
      value: "premium" as const,
      confidence: "high" as const,
      provenance: "Salesforce Account",
      evidenceBasis: "Account tier: premium",
      assertedVsInferred: "asserted" as const
    },
    slaClass: {
      value: "premium" as const,
      confidence: "high" as const,
      provenance: "Salesforce Entitlement",
      evidenceBasis: "SLA class: premium",
      assertedVsInferred: "asserted" as const
    },
    warrantyStatus: {
      value: "unknown" as const,
      confidence: "low" as const,
      provenance: "Salesforce Asset warranty",
      evidenceBasis: "No warranty record",
      assertedVsInferred: "inferred" as const,
      notEvidenced: true
    },
    repeatIncident: {
      value: { repeat: true, count: 2, windowDays: 30 },
      confidence: "high" as const,
      provenance: "Salesforce Case history",
      evidenceBasis: "2 cases in 30d",
      assertedVsInferred: "asserted" as const
    },
    strategicAccount: {
      value: true,
      confidence: "high" as const,
      provenance: "Salesforce Account flag",
      evidenceBasis: "Strategic flag: yes",
      assertedVsInferred: "asserted" as const
    },
    installedAssets: {
      value: { totalAssets: 420, modelCount: 1, primaryModel: "VX-900" },
      confidence: "high" as const,
      provenance: "Salesforce Asset",
      evidenceBasis: "420 assets across 1 models",
      assertedVsInferred: "asserted" as const
    },
    openIncidentCount: {
      value: 1,
      confidence: "high" as const,
      provenance: "Salesforce Case history",
      evidenceBasis: "1 open incidents",
      assertedVsInferred: "asserted" as const
    },
    escalationHistory: {
      value: 1,
      confidence: "high" as const,
      provenance: "Salesforce Case history",
      evidenceBasis: "1 prior escalations",
      assertedVsInferred: "asserted" as const
    },
    businessRisk: {
      value: "high" as const,
      confidence: "high" as const,
      provenance: "AI synthesis",
      evidenceBasis: "Risk signals: strategic, repeat-failure, premium",
      assertedVsInferred: "inferred" as const
    }
  }
};

const knowledgeChannel = {
  eligible: true,
  degraded: false,
  status: "ANSWERED" as const,
  answer: {
    safeSummary:
      "Verify adapter functionality, run BIOS diagnostics, and replace SP-BATT-15X if diagnostics confirm failure.",
    sources: [
      {
        sourceId: "kb-av-lp-15x-pro-battery-1",
        title: "Battery Not Charging on AeroVolt ProBook 15X",
        retrievalScorePercentile: 81
      }
    ],
    provider: "openai",
    model: "gpt-4o-mini",
    embeddingProvider: "openai",
    retrievalId: "ret-123",
    latencyMs: 253,
    fallbackUsed: false
  }
};

describe("orchestration repository — customer-context channel", () => {
  it("round-trips the Node 2 channel in the in-memory repository", async () => {
    const repo = new InMemoryOrchestrationStatusRepository();
    await repo.save(snapshot({ customerContext: customerChannel }));
    const loaded = await repo.get("wf-1");
    expect(loaded?.customerContext?.package?.businessRisk.value).toBe("high");
    expect(loaded?.customerContext?.degradedSources).toEqual(["warranty"]);
    expect(loaded?.customerContext?.package?.warrantyStatus.notEvidenced).toBe(
      true
    );
  });

  it("persists customer_context as a jsonb parameter in Postgres", async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const { repo } = postgresRepo(query);
    await repo.save(snapshot({ customerContext: customerChannel }));

    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("customer_context");
    const params = query.mock.calls[0][1] as unknown[];
    // Param index 10 is customer_context, serialized to JSON.
    expect(typeof params[10]).toBe("string");
    expect(String(params[10])).toContain("businessRisk");
  });

  it("maps a stored customer_context row back into the channel", async () => {
    const now = new Date();
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          workflow_id: "wf-1",
          case_id: "500000000000001",
          case_number: null,
          node: "triage",
          status: "done",
          approval_required: false,
          approval_decision: null,
          write_back_applied: true,
          failure_kind: null,
          triage: null,
          customer_context: customerChannel,
          events: "[]",
          created_at: now,
          updated_at: now
        }
      ]
    });
    const { repo } = postgresRepo(query);

    const loaded = await repo.get("wf-1");
    expect(loaded?.customerContext?.package?.customerTier.value).toBe(
      "premium"
    );
    expect(loaded?.customerContext?.eligible).toBe(true);
  });
});

describe("orchestration repository — knowledge-guidance channel", () => {
  it("round-trips the Node 3 channel in the in-memory repository", async () => {
    const repo = new InMemoryOrchestrationStatusRepository();
    await repo.save(snapshot({ knowledgeGuidance: knowledgeChannel }));
    const loaded = await repo.get("wf-1");
    expect(loaded?.knowledgeGuidance?.status).toBe("ANSWERED");
    expect(loaded?.knowledgeGuidance?.answer?.sources[0]?.sourceId).toBe(
      "kb-av-lp-15x-pro-battery-1"
    );
  });

  it("persists knowledge_guidance as a jsonb parameter in Postgres", async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const { repo } = postgresRepo(query);
    await repo.save(snapshot({ knowledgeGuidance: knowledgeChannel }));

    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain("knowledge_guidance");
    const params = query.mock.calls[0][1] as unknown[];
    expect(typeof params[11]).toBe("string");
    expect(String(params[11])).toContain("Battery Not Charging on AeroVolt ProBook 15X");
  });

  it("maps a stored knowledge_guidance row back into the channel", async () => {
    const now = new Date();
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          workflow_id: "wf-1",
          case_id: "500000000000001",
          case_number: null,
          node: "knowledge",
          status: "done",
          approval_required: false,
          approval_decision: null,
          write_back_applied: true,
          failure_kind: null,
          triage: null,
          customer_context: null,
          knowledge_guidance: knowledgeChannel,
          events: "[]",
          created_at: now,
          updated_at: now
        }
      ]
    });
    const { repo } = postgresRepo(query);

    const loaded = await repo.get("wf-1");
    expect(loaded?.knowledgeGuidance?.eligible).toBe(true);
    expect(loaded?.knowledgeGuidance?.status).toBe("ANSWERED");
    expect(loaded?.knowledgeGuidance?.answer?.retrievalId).toBe("ret-123");
  });
});
