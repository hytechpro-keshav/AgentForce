import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { AppModule } from "../src/app.module";

describe("HealthController (e2e)", () => {
  let app: INestApplication | undefined;
  const previousHealthKey = process.env.AGENTFORCE_HEALTH_API_KEY;

  async function createApp(healthKey?: string): Promise<INestApplication> {
    if (healthKey === undefined) {
      delete process.env.AGENTFORCE_HEALTH_API_KEY;
    } else {
      process.env.AGENTFORCE_HEALTH_API_KEY = healthKey;
    }

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    const nestApp = moduleRef.createNestApplication();
    await nestApp.init();
    return nestApp;
  }

  afterEach(async () => {
    await app?.close();
    app = undefined;

    if (previousHealthKey === undefined) {
      delete process.env.AGENTFORCE_HEALTH_API_KEY;
    } else {
      process.env.AGENTFORCE_HEALTH_API_KEY = previousHealthKey;
    }
  });

  it("GET /health/live returns minimal public liveness", async () => {
    app = await createApp("test-health-key");

    const response = await request(app.getHttpServer())
      .get("/health/live")
      .expect(200);

    expect(response.body).toEqual({ status: "ok" });
  });

  it("GET /health returns structured health and bridge context", async () => {
    app = await createApp("test-health-key");

    const response = await request(app.getHttpServer())
      .get("/health")
      .set("X-Agentforce-Health-Key", "test-health-key")
      .expect(200);

    expect(response.body).toMatchObject({
      status: "ok",
      service: {
        name: "ai-api"
      },
      salesforceBridge: {
        phase: "phase-1-external-bridge",
        namedCredential: "Agentforce_AI_API",
        apexAction: "AgentforceAiApiHealthCheck",
        endpoint: "/health"
      },
      deferredCapabilities: {
        providerRouting: "phase-2",
        rag: "phase-4",
        openWebUi: "phase-5",
        reactChat: "phase-6"
      }
    });
  });

  it("GET /health requires the configured Salesforce bridge key", async () => {
    app = await createApp("test-health-key");

    await request(app.getHttpServer()).get("/health").expect(401);

    await request(app.getHttpServer())
      .get("/health")
      .set("X-Agentforce-Health-Key", "wrong-key")
      .expect(401);

    await request(app.getHttpServer())
      .get("/health")
      .set("X-Agentforce-Health-Key", "test-health-key")
      .expect(200);
  });

  it("GET /health fails closed when the bridge key is not configured", async () => {
    app = await createApp();

    await request(app.getHttpServer()).get("/health").expect(503);
  });
});
