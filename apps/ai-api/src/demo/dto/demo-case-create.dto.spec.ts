import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

import { DemoCaseCreateDto } from "./demo-case-create.dto";

function errorsFor(payload: Record<string, unknown>): string[] {
  const instance = plainToInstance(DemoCaseCreateDto, payload);
  const collect = (errors: ReturnType<typeof validateSync>): string[] =>
    errors.flatMap((e) => [
      ...Object.keys(e.constraints ?? {}),
      ...collect(e.children ?? [])
    ]);
  return collect(validateSync(instance, { whitelist: true }));
}

describe("DemoCaseCreateDto", () => {
  it("accepts a scenarioId-only payload", () => {
    expect(errorsFor({ scenarioId: "same-day-battery-fix" })).toHaveLength(0);
  });

  it("accepts a full custom form payload", () => {
    expect(
      errorsFor({
        form: {
          subject: "Test",
          description: "SP-BATT-15X",
          status: "New",
          origin: "Web",
          priority: "High",
          accountLookup: { name: "Aptivance tech" },
          assetLookup: { serialNumber: "SN-PRO15X-2026-0041A" },
          shipTo: { city: "Austin", state: "TX", country: "US" }
        }
      })
    ).toHaveLength(0);
  });

  it("accepts partial overrides for a catalog scenario", () => {
    expect(
      errorsFor({
        scenarioId: "same-day-battery-fix",
        overrides: {
          subject: "Edited subject",
          description: "SP-BATT-15X",
          priority: "High",
          shipTo: { city: "Austin", state: "TX", country: "US" }
        }
      })
    ).toHaveLength(0);
  });

  it("rejects an invalid priority", () => {
    expect(
      errorsFor({
        form: {
          subject: "Test",
          description: "desc",
          status: "New",
          origin: "Web",
          priority: "Critical",
          accountLookup: { name: "Aptivance tech" },
          assetLookup: { serialNumber: "SN-PRO15X-2026-0041A" },
          shipTo: { city: "Austin", state: "TX", country: "US" }
        }
      })
    ).toContain("isIn");
  });
});
