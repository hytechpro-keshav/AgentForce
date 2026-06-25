import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validateSync, type ValidationError } from "class-validator";

import { TriageCaseRequestDto } from "./triage-case.dto";

/** Mirrors the production global pipe (whitelist + forbidNonWhitelisted). */
function validate(payload: Record<string, unknown>): ValidationError[] {
  const instance = plainToInstance(TriageCaseRequestDto, payload);
  return validateSync(instance, {
    whitelist: true,
    forbidNonWhitelisted: true
  });
}

/** Flattens constraint keys across nested ValidationError children. */
function constraintKeys(errors: ValidationError[]): string[] {
  return errors.flatMap((e) => [
    ...Object.keys(e.constraints ?? {}),
    ...constraintKeys(e.children ?? [])
  ]);
}

const base = {
  subject: "Recurring outage",
  description: "Unit keeps failing every few days."
};

const validSignals = {
  customerTier: "premium",
  slaClass: "premium",
  warrantyStatus: "covered",
  strategicAccount: true,
  repeatIncident: { repeat: true, count: 2 },
  openIncidentCount: 1,
  escalationHistory: 1,
  businessRisk: "high",
  primaryModel: "VX-900",
  degraded: false
};

describe("TriageCaseRequestDto — Phase B customerSignals", () => {
  it("validates a minimal request without customerSignals (backward compat)", () => {
    expect(validate(base)).toHaveLength(0);
  });

  it("validates a request with a fully-populated customerSignals block", () => {
    expect(validate({ ...base, customerSignals: validSignals })).toHaveLength(
      0
    );
  });

  it("validates an empty customerSignals object (every field optional)", () => {
    expect(validate({ ...base, customerSignals: {} })).toHaveLength(0);
  });

  it("rejects an out-of-vocabulary customerTier", () => {
    const errors = validate({
      ...base,
      customerSignals: { ...validSignals, customerTier: "platinum" }
    });
    expect(constraintKeys(errors)).toContain("isIn");
  });

  it("rejects a negative repeatIncident count (nested validation)", () => {
    const errors = validate({
      ...base,
      customerSignals: {
        ...validSignals,
        repeatIncident: { repeat: true, count: -3 }
      }
    });
    expect(constraintKeys(errors)).toContain("min");
  });

  it("rejects a non-boolean strategicAccount", () => {
    const errors = validate({
      ...base,
      customerSignals: { ...validSignals, strategicAccount: "yes" }
    });
    expect(constraintKeys(errors)).toContain("isBoolean");
  });
});
