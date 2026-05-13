import { ChatShell } from "@/components/ChatShell";

/**
 * Server component entry point. Brand strings are resolved
 * server-side from env vars; no bearer tokens, access codes, or
 * vendor secrets are ever exposed to the client.
 */
export default function HomePage() {
  const brandName = process.env.BRAND_NAME ?? "Customer Support";
  const brandSubtitle =
    process.env.BRAND_SUBTITLE ?? "Sign in with your access code to start.";
  return <ChatShell brandName={brandName} brandSubtitle={brandSubtitle} />;
}
