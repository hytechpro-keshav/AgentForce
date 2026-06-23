import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { DemoCaseFormDto } from "./dto/demo-case-create.dto";

export interface DemoCaseScenarioCatalogEntry {
  id: string;
  label: string;
  shortDescription: string;
  story?: string;
  badges?: Record<string, string>;
  expectedOutcome?: Record<string, unknown>;
  inventoryBasis?: Record<string, unknown>;
  form: DemoCaseFormDto;
}

export interface DemoCaseScenarioCatalog {
  catalogVersion: string;
  generatedAt: string;
  orgAlias: string;
  scenarios: DemoCaseScenarioCatalogEntry[];
}

let cachedCatalog: DemoCaseScenarioCatalog | undefined;

export function loadDemoCaseScenarioCatalog(): DemoCaseScenarioCatalog {
  if (cachedCatalog) {
    return cachedCatalog;
  }
  const candidates = [
    join(__dirname, "../../../data/demo-case-scenarios.json"),
    join(__dirname, "../../data/demo-case-scenarios.json")
  ];
  let raw: string | undefined;
  for (const catalogPath of candidates) {
    try {
      raw = readFileSync(catalogPath, "utf8");
      break;
    } catch {
      continue;
    }
  }
  if (!raw) {
    throw new Error("Demo case scenario catalog not found on disk.");
  }
  cachedCatalog = JSON.parse(raw) as DemoCaseScenarioCatalog;
  return cachedCatalog;
}

export function resetDemoCaseScenarioCatalogCache(): void {
  cachedCatalog = undefined;
}

export function findScenarioById(
  scenarioId: string
): DemoCaseScenarioCatalogEntry | undefined {
  return loadDemoCaseScenarioCatalog().scenarios.find(
    (scenario) => scenario.id === scenarioId
  );
}
