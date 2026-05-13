/**
 * Customer-safe source descriptor. Only `title`, optional safe URL,
 * and optional snippet are surfaced. Internal identifiers (chunk
 * IDs, namespaces, Salesforce record IDs, raw retrieval payloads)
 * must never reach the browser.
 */
export interface CustomerSafeSource {
  title: string;
  url?: string;
  snippet?: string;
}

const ALLOWED_KEYS = new Set<keyof CustomerSafeSource>([
  "title",
  "url",
  "snippet"
]);

export function sanitizeSources(value: unknown): CustomerSafeSource[] {
  if (!Array.isArray(value)) return [];
  const out: CustomerSafeSource[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const title =
      typeof record.title === "string" && record.title.trim()
        ? record.title.trim().slice(0, 180)
        : undefined;
    if (!title) continue;
    const safe: CustomerSafeSource = { title };
    if (
      typeof record.url === "string" &&
      /^https?:\/\//i.test(record.url) &&
      record.url.length <= 500
    ) {
      safe.url = record.url;
    }
    if (typeof record.snippet === "string" && record.snippet.trim()) {
      safe.snippet = record.snippet.trim().slice(0, 400);
    }
    // Defense in depth: drop any unknown keys.
    for (const key of Object.keys(safe) as Array<keyof CustomerSafeSource>) {
      if (!ALLOWED_KEYS.has(key)) {
        delete (safe as unknown as Record<string, unknown>)[key];
      }
    }
    out.push(safe);
  }
  return out;
}
