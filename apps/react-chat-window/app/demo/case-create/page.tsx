import Link from "next/link";
import type { ReactNode } from "react";

import { DemoCaseCreateForm } from "@/components/DemoCaseCreateForm";
import { loadScenarioCatalog } from "@/lib/demo-case-scenarios";

export const dynamic = "force-dynamic";

export default function DemoCaseCreatePage() {
  const catalog = loadScenarioCatalog();

  return (
    <main className="min-h-screen bg-gradient-to-b from-primary/5 via-background to-background">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 p-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <p className="text-sm font-medium text-primary">AgentForce demo</p>
            <h1 className="text-3xl font-semibold tracking-tight">
              Create a live Salesforce Case
            </h1>
            <p className="max-w-2xl text-muted-foreground">
              Test the full AI service workflow — pick a scenario, create a real
              Case in Salesforce, and step through each orchestration stage in
              the stepped console.
            </p>
          </div>
          <ButtonLink href="/orchestration/stepped">Stepped console</ButtonLink>
        </header>

        <DemoCaseCreateForm scenarios={catalog.scenarios} />

        <p className="text-xs text-muted-foreground">
          Catalog v{catalog.catalogVersion} · org {catalog.orgAlias} · snapshot{" "}
          {new Date(catalog.generatedAt).toLocaleString()}
        </p>
      </div>
    </main>
  );
}

function ButtonLink({
  href,
  children
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent"
    >
      {children}
    </Link>
  );
}
