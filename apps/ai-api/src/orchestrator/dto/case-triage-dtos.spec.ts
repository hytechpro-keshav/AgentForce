import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { TriggerCaseTriageDto } from "./trigger-case-triage.dto";
import { ResumeCaseTriageDto } from "./resume-case-triage.dto";

function errorsFor<T extends object>(
  cls: new () => T,
  payload: Record<string, unknown>
): string[] {
  const instance = plainToInstance(cls, payload);
  return validateSync(instance, { whitelist: true }).flatMap((e) =>
    Object.keys(e.constraints ?? {})
  );
}

describe("TriggerCaseTriageDto", () => {
  it("accepts a 15 or 18 character Salesforce id", () => {
    expect(
      errorsFor(TriggerCaseTriageDto, { caseId: "500000000000001" })
    ).toHaveLength(0);
    expect(
      errorsFor(TriggerCaseTriageDto, { caseId: "500000000000001ABC" })
    ).toHaveLength(0);
  });

  it("accepts optional safe caseNumber and correlationId", () => {
    expect(
      errorsFor(TriggerCaseTriageDto, {
        caseId: "500000000000001",
        caseNumber: "00001234",
        correlationId: "sf-triage-1"
      })
    ).toHaveLength(0);
  });

  it("rejects a malformed caseId", () => {
    expect(errorsFor(TriggerCaseTriageDto, { caseId: "not-an-id" })).toContain(
      "matches"
    );
    expect(errorsFor(TriggerCaseTriageDto, {})).toContain("isString");
  });

  it("rejects a non-numeric caseNumber", () => {
    expect(
      errorsFor(TriggerCaseTriageDto, {
        caseId: "500000000000001",
        caseNumber: "00-01; DROP"
      })
    ).toContain("matches");
  });

  it("rejects an unsafe correlationId", () => {
    expect(
      errorsFor(TriggerCaseTriageDto, {
        caseId: "500000000000001",
        correlationId: "bad id with spaces"
      })
    ).toContain("matches");
  });
});

describe("ResumeCaseTriageDto", () => {
  it("accepts approved/rejected with a safe idempotency key", () => {
    expect(
      errorsFor(ResumeCaseTriageDto, {
        decision: "approved",
        idempotencyKey: "approve-1"
      })
    ).toHaveLength(0);
    expect(
      errorsFor(ResumeCaseTriageDto, {
        decision: "rejected",
        idempotencyKey: "reject-1"
      })
    ).toHaveLength(0);
  });

  it("rejects an unknown decision", () => {
    expect(
      errorsFor(ResumeCaseTriageDto, {
        decision: "maybe",
        idempotencyKey: "k1"
      })
    ).toContain("isIn");
  });

  it("requires an idempotency key", () => {
    expect(errorsFor(ResumeCaseTriageDto, { decision: "approved" })).toContain(
      "isString"
    );
  });
});
