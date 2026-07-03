import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as jwt from "jsonwebtoken";
import request from "supertest";

import { AppModule } from "../src/app.module";
import { ModelRouter } from "../src/llm/model-router";
import { SalesforceCaseWriteGateway } from "../src/salesforce/salesforce-case-write.gateway";
import { SalesforceOtpGateway } from "../src/salesforce/salesforce-otp.gateway";

const TEST_JWT_SECRET = "intake-e2e-secret";
const ACCOUNT_ID = "001000000000001";
const CONTACT_ID = "003000000000001";
const ASSET_ID = "02i000000000001";

describe("Customer intake (e2e)", () => {
  let app: INestApplication;
  let otpGateway: {
    isConfigured: jest.Mock;
    generate: jest.Mock;
    verify: jest.Mock;
  };
  let caseWriteGateway: {
    isConfigured: jest.Mock;
    resolveContactByEmailGlobal: jest.Mock;
    listAccountAssets: jest.Mock;
    readAccountContext: jest.Mock;
    readContactSummary: jest.Mock;
    assetBelongsToAccount: jest.Mock;
    createChatCase: jest.Mock;
  };

  beforeAll(async () => {
    process.env.AI_API_JWT_SECRET = TEST_JWT_SECRET;
    process.env.CUSTOMER_INTAKE_ENABLED = "true";
    process.env.CUSTOMER_INTAKE_RATE_LIMIT_MAX_REQUESTS = "1000";
    process.env.RAG_ENABLED = "true";
    process.env.DEFAULT_EMBEDDING_PROVIDER = "deterministic";
    process.env.VECTOR_DB_PROVIDER = "memory";
    process.env.RAG_DEFAULT_NAMESPACE = "customer-self-service";
    delete process.env.AI_API_AUTH_DISABLED;
    delete process.env.AGENTFORCE_HEALTH_API_KEY;

    otpGateway = {
      isConfigured: jest.fn().mockReturnValue(true),
      generate: jest.fn().mockResolvedValue({ status: "SENT", expiresInSeconds: 600 }),
      verify: jest.fn().mockResolvedValue({ valid: true, status: "VERIFIED" })
    };
    caseWriteGateway = {
      isConfigured: jest.fn().mockReturnValue(true),
      resolveContactByEmailGlobal: jest.fn().mockResolvedValue({
        status: "found",
        contactId: CONTACT_ID,
        accountId: ACCOUNT_ID,
        name: "Ada Lovelace"
      }),
      listAccountAssets: jest.fn().mockResolvedValue([
        {
          assetId: ASSET_ID,
          label: "ThinkPad X1",
          product: "ThinkPad",
          serialNumber: "SN-SECRET-123"
        }
      ]),
      readAccountContext: jest.fn().mockResolvedValue({
        accountName: "Analytical Engines Ltd",
        shipToCity: "London",
        shipToState: "LDN",
        shipToCountry: "UK"
      }),
      readContactSummary: jest
        .fn()
        .mockResolvedValue({ name: "Ada Lovelace", email: "ada@corp.com" }),
      assetBelongsToAccount: jest.fn().mockResolvedValue(true),
      createChatCase: jest
        .fn()
        .mockResolvedValue({ caseId: "500000000000001", caseNumber: "00001234" })
    };

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    })
      .overrideProvider(SalesforceOtpGateway)
      .useValue(otpGateway)
      .overrideProvider(SalesforceCaseWriteGateway)
      .useValue(caseWriteGateway)
      .overrideProvider(ModelRouter)
      .useValue({ chat: jest.fn(), chatStream: jest.fn() })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true
      })
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.AI_API_JWT_SECRET;
    delete process.env.CUSTOMER_INTAKE_ENABLED;
    delete process.env.CUSTOMER_INTAKE_RATE_LIMIT_MAX_REQUESTS;
    delete process.env.RAG_ENABLED;
    delete process.env.DEFAULT_EMBEDDING_PROVIDER;
    delete process.env.VECTOR_DB_PROVIDER;
    delete process.env.RAG_DEFAULT_NAMESPACE;
  });

  it("returns a uniform response for OTP request of a known email", async () => {
    const res = await request(app.getHttpServer())
      .post("/intake/otp/request")
      .send({ email: "User@Example.com" })
      .expect(200);
    expect(res.body.status).toBe("sent");
    expect(otpGateway.generate).toHaveBeenCalledWith("user@example.com", undefined);
  });

  it("rejects a malformed email with 400", async () => {
    await request(app.getHttpServer())
      .post("/intake/otp/request")
      .send({ email: "not-an-email" })
      .expect(400);
  });

  it("rejects an invalid OTP code with 401", async () => {
    otpGateway.verify.mockResolvedValueOnce({ valid: false, status: "INVALID_CODE" });
    await request(app.getHttpServer())
      .post("/intake/otp/verify")
      .send({ email: "user@example.com", code: "000000" })
      .expect(401);
  });

  it("mints a chat:intake token on valid OTP and gates the intake routes", async () => {
    const verifyRes = await request(app.getHttpServer())
      .post("/intake/otp/verify")
      .send({ email: "user@example.com", code: "123456" })
      .expect(200);

    const token = verifyRes.body.accessToken as string;
    expect(token).toBeTruthy();
    const decoded = jwt.verify(token, TEST_JWT_SECRET) as jwt.JwtPayload;
    expect(decoded.scope).toBe("chat:intake chat:write");
    expect(decoded.accountId).toBe(ACCOUNT_ID);
    expect(decoded.contactId).toBe(CONTACT_ID);

    // context requires the token
    await request(app.getHttpServer()).get("/intake/context").expect(401);

    const contextRes = await request(app.getHttpServer())
      .get("/intake/context")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(contextRes.body.displayName).toBe("Ada Lovelace");
    expect(contextRes.body.devices).toHaveLength(1);
    expect(JSON.stringify(contextRes.body)).not.toContain("SN-SECRET-123");

    // case create is scoped to the verified identity
    const caseRes = await request(app.getHttpServer())
      .post("/intake/case")
      .set("Authorization", `Bearer ${token}`)
      .send({
        issueDescription: "Screen flickers and then goes black on boot.",
        assetId: ASSET_ID
      })
      .expect(201);
    expect(caseRes.body.caseId).toBe("500000000000001");
    const createdFields = caseWriteGateway.createChatCase.mock.calls[0][0];
    expect(createdFields.accountId).toBe(ACCOUNT_ID);
    expect(createdFields.contactId).toBe(CONTACT_ID);
    expect(createdFields.assetId).toBe(ASSET_ID);
  });
});
