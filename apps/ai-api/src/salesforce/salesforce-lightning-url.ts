const DEFAULT_LIGHTNING_BASE =
  "https://orgfarm-d96842e593-dev-ed.develop.lightning.force.com";

/** Lightning record page for a Salesforce Case id. */
export function buildSalesforceCaseRecordUrl(caseId: string): string {
  const base = (
    process.env.SALESFORCE_INSTANCE_URL ??
    process.env.SALESFORCE_LIGHTNING_BASE_URL ??
    DEFAULT_LIGHTNING_BASE
  ).replace(/\/+$/, "");
  return `${base}/lightning/r/Case/${encodeURIComponent(caseId)}/view`;
}
