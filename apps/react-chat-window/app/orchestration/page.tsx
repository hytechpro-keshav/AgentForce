import { OrchestrationView } from "@/components/OrchestrationView";
import { isValidCaseId, isValidWorkflowId } from "@/lib/orchestration";

export const dynamic = "force-dynamic";

/**
 * Internal, read-only orchestration engineering console.
 *
 * Open it with `?workflowId=wf-...` when you have the workflow id, or
 * `?caseId=500...` for the latest live workflow for that Case. This
 * surface renders sanitized Node 1 and Node 2 execution artifacts; it
 * never exposes approval controls or hidden reasoning.
 */
export default function OrchestrationPage({
  searchParams
}: {
  searchParams: { workflowId?: string; caseId?: string };
}) {
  const workflowId = searchParams.workflowId?.trim();
  const caseId = searchParams.caseId?.trim();
  const validWorkflowId = workflowId ? isValidWorkflowId(workflowId) : false;
  const validCaseId = caseId ? isValidCaseId(caseId) : false;

  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Orchestration Console</h1>
        <p className="text-sm text-muted-foreground">
          Live, read-only engineering view of Node 1 triage and Node 2 customer context.
        </p>
      </div>

      {validWorkflowId && workflowId ? (
        <OrchestrationView workflowId={workflowId} />
      ) : validCaseId && caseId ? (
        <OrchestrationView caseId={caseId} />
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
