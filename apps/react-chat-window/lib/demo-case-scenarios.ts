import catalog from "@/data/demo-case-scenarios.json";

export interface DemoCaseShipTo {
  city: string;
  state: string;
  country: string;
}

export interface DemoCaseForm {
  subject: string;
  description: string;
  status: string;
  origin: string;
  priority: string;
  accountLookup: { name: string };
  contactLookup?: { email: string };
  assetLookup: { serialNumber: string };
  suppliedName?: string;
  suppliedEmail?: string;
  shipTo: DemoCaseShipTo;
  partCodes?: string[];
}

export interface DemoCaseScenario {
  id: string;
  label: string;
  shortDescription: string;
  story?: string;
  category?: string[];
  badges?: Record<string, string>;
  expectedOutcome?: {
    summary?: string;
    node4?: Record<string, unknown>;
    node5?: Record<string, unknown>;
    node6?: Record<string, unknown>;
  };
  inventoryBasis?: {
    parts?: Array<{ code: string; warehouse: string; qty: number }>;
    fulfillmentWarehouse?: string;
    shipToResolvesTo?: string;
  };
  form: DemoCaseForm;
}

export interface DemoCaseScenarioCatalog {
  catalogVersion: string;
  generatedAt: string;
  orgAlias: string;
  scenarios: DemoCaseScenario[];
}

export function loadScenarioCatalog(): DemoCaseScenarioCatalog {
  return catalog as DemoCaseScenarioCatalog;
}

export function getScenarioById(id: string): DemoCaseScenario | undefined {
  return loadScenarioCatalog().scenarios.find((scenario) => scenario.id === id);
}

export function emptyCustomForm(): DemoCaseForm {
  return {
    subject: "",
    description: "",
    status: "New",
    origin: "Web",
    priority: "Medium",
    accountLookup: { name: "University of Arizona" },
    contactLookup: { email: "jane_gray@uoa.edu" },
    assetLookup: { serialNumber: "SN-PRO15X-2026-0041A" },
    suppliedName: "Jane Grey",
    suppliedEmail: "jane_gray@uoa.edu",
    shipTo: { city: "Austin", state: "TX", country: "US" }
  };
}
