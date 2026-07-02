import type { IntakeContext, IntakeSession } from "@/lib/intake-flow";

export interface IntakeClientConfig {
  emailVerificationEnabled: boolean;
  bootstrapAvailable: boolean;
}

export async function fetchIntakeConfig(): Promise<IntakeClientConfig> {
  const res = await fetch("/api/intake/config", { cache: "no-store" });
  if (!res.ok) {
    return { emailVerificationEnabled: true, bootstrapAvailable: false };
  }
  const json = (await res.json()) as Partial<IntakeClientConfig>;
  return {
    emailVerificationEnabled: json.emailVerificationEnabled !== false,
    bootstrapAvailable: json.bootstrapAvailable === true
  };
}

export async function bootstrapIntakeSession(): Promise<IntakeSession> {
  const res = await fetch("/api/intake/session/bootstrap", {
    method: "POST",
    headers: { "content-type": "application/json" }
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      typeof json.message === "string"
        ? json.message
        : "Could not start the intake session."
    );
  }
  const accessToken = String(json.accessToken ?? "");
  if (!accessToken) {
    throw new Error("Bootstrap did not return an access token.");
  }
  return {
    accessToken,
    expiresAt: String(json.expiresAt ?? ""),
    subject: String(json.subject ?? "customer-intake-session")
  };
}

export async function loadIntakeContext(
  accessToken: string
): Promise<IntakeContext> {
  const res = await fetch("/api/intake/context", {
    headers: { authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) {
    return { devices: [], shipTo: {} };
  }
  const context = (await res.json()) as IntakeContext;
  return {
    displayName: context.displayName,
    accountName: context.accountName,
    devices: Array.isArray(context.devices) ? context.devices : [],
    shipTo: context.shipTo ?? {}
  };
}

export function deviceGreeting(context: IntakeContext): string | null {
  if (context.devices.length === 0) {
    return null;
  }
  const labels = context.devices.map((device) => device.label).join(", ");
  return `I can see ${context.devices.length} device(s) on your account: ${labels}. Tell me what's going wrong and pick the affected laptop below.`;
}
