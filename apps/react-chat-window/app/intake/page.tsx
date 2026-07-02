import { notFound } from "next/navigation";

import { IntakeShell } from "@/components/IntakeShell";

export const dynamic = "force-dynamic";

/**
 * Guided OTP intake entry point. Feature-flagged with CUSTOMER_INTAKE_ENABLED
 * so it is hidden until the backend + Salesforce OTP are configured. Brand
 * strings resolve server-side; no tokens or secrets reach the client.
 */
export default function IntakePage() {
  if (process.env.CUSTOMER_INTAKE_ENABLED !== "true") {
    notFound();
  }
  const brandName = process.env.BRAND_NAME ?? "Laptop Support";
  const brandSubtitle =
    process.env.BRAND_SUBTITLE ??
    "Verify your email to start a support request.";
  return <IntakeShell brandName={brandName} brandSubtitle={brandSubtitle} />;
}
