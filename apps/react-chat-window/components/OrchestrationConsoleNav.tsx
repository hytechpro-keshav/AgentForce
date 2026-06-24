import Link from "next/link";

import { cn } from "@/lib/utils";

function consoleHref(
  base: "/orchestration" | "/orchestration/stepped",
  caseId?: string,
  workflowId?: string
): string {
  if (workflowId) {
    return `${base}?workflowId=${encodeURIComponent(workflowId)}`;
  }
  if (caseId) {
    return `${base}?caseId=${encodeURIComponent(caseId)}`;
  }
  return base;
}

interface OrchestrationConsoleNavProps {
  active: "classic" | "stepped";
  caseId?: string;
  workflowId?: string;
  className?: string;
}

/**
 * Cross-link between the read-only engineering console and the stepped spine
 * console, preserving the current Case or workflow id in the query string.
 */
export function OrchestrationConsoleNav({
  active,
  caseId,
  workflowId,
  className
}: OrchestrationConsoleNavProps) {
  const linkClass = (isActive: boolean) =>
    cn(
      "rounded-md px-3 py-1.5 font-medium transition-colors",
      isActive
        ? "bg-primary text-primary-foreground"
        : "text-muted-foreground hover:bg-muted hover:text-foreground"
    );

  return (
    <nav
      className={cn("inline-flex gap-1 rounded-lg border bg-muted/40 p-1", className)}
      aria-label="Orchestration console views"
    >
      <Link
        href={consoleHref("/orchestration", caseId, workflowId)}
        className={linkClass(active === "classic")}
        aria-current={active === "classic" ? "page" : undefined}
      >
        Engineering console
      </Link>
      <Link
        href={consoleHref("/orchestration/stepped", caseId, workflowId)}
        className={linkClass(active === "stepped")}
        aria-current={active === "stepped" ? "page" : undefined}
      >
        Stepped console
      </Link>
    </nav>
  );
}
