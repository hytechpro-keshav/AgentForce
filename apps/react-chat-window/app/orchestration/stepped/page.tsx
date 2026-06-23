import { JetBrains_Mono, Space_Grotesk } from "next/font/google";

import { SteppedOrchestrationView } from "@/components/SteppedOrchestrationView";
import { isValidCaseId, isValidWorkflowId } from "@/lib/orchestration";

export const dynamic = "force-dynamic";

// Scoped to this route only — the rest of the app keeps the system font stack.
const grotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-grot",
  display: "swap"
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap"
});

/**
 * Stepped orchestration console (Phase 1 — replay).
 *
 * Renders the approved spine design for a real run. Open with `?caseId=500…`
 * for the latest live workflow on that Case, or `?workflowId=wf-…` for a
 * specific workflow. Triage auto-reveals once the case is assigned; each later
 * stage exposes a "Run" button that reveals its real, already-computed result.
 * The existing read-only console at `/orchestration` is left untouched.
 */
export default function SteppedOrchestrationPage({
  searchParams
}: {
  searchParams: { workflowId?: string; caseId?: string };
}) {
  const workflowId = searchParams.workflowId?.trim();
  const caseId = searchParams.caseId?.trim();
  const validWorkflowId = workflowId ? isValidWorkflowId(workflowId) : false;
  const validCaseId = caseId ? isValidCaseId(caseId) : false;

  return (
    <main
      className={`${grotesk.variable} ${mono.variable} mx-auto min-h-screen max-w-[1240px] p-6`}
    >
      {validWorkflowId && workflowId ? (
        <SteppedOrchestrationView workflowId={workflowId} />
      ) : validCaseId && caseId ? (
        <SteppedOrchestrationView caseId={caseId} />
      ) : (
        <div className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">
          Provide a workflow id or Case id in the URL, for example{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-foreground">
            ?workflowId=wf-…
          </code>
          {" or "}
          <code className="rounded bg-muted px-1 py-0.5 text-foreground">
            ?caseId=500…
          </code>
          .
        </div>
      )}
    </main>
  );
}
