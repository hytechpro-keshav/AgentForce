import { SalesforceGatewayError } from "./salesforce-gateway.error";

/**
 * Thin fetch wrapper with a hard timeout. Network and timeout
 * failures are normalized into a {@link SalesforceGatewayError} so
 * callers never see raw undici errors (which can embed the URL).
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (err) {
    const name = (err as Error)?.name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw new SalesforceGatewayError(
        "timeout",
        "Salesforce request timed out."
      );
    }
    throw new SalesforceGatewayError(
      "network",
      "Salesforce request could not be completed."
    );
  }
}

/**
 * Parse a JSON body defensively. A body that is not an object is
 * treated as malformed rather than throwing a raw parse error.
 */
export async function readJsonObject(
  response: Response
): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new SalesforceGatewayError(
      "malformed",
      "Salesforce returned an unreadable response."
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SalesforceGatewayError(
      "malformed",
      "Salesforce returned an unexpected response shape."
    );
  }
  return parsed as Record<string, unknown>;
}
