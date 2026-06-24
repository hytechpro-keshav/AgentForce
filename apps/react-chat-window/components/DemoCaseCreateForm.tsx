"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  emptyCustomForm,
  getScenarioById,
  type DemoCaseForm,
  type DemoCaseScenario
} from "@/lib/demo-case-scenarios";

interface DemoCaseCreateFormProps {
  scenarios: DemoCaseScenario[];
}

interface CreateResponse {
  caseId: string;
  caseNumber?: string;
  orchestrationUrl: string;
  steppedOrchestrationUrl: string;
}

export function DemoCaseCreateForm({ scenarios }: DemoCaseCreateFormProps) {
  const router = useRouter();
  const defaultScenarioId =
    scenarios.find((scenario) => scenario.id !== "custom")?.id ??
    scenarios[0]?.id ??
    "custom";

  const [scenarioId, setScenarioId] = useState(defaultScenarioId);
  const [form, setForm] = useState<DemoCaseForm>(() => {
    const scenario = getScenarioById(defaultScenarioId);
    return scenario?.form ?? emptyCustomForm();
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedScenario = useMemo(
    () => scenarios.find((scenario) => scenario.id === scenarioId),
    [scenarioId, scenarios]
  );

  function onScenarioChange(nextId: string) {
    setScenarioId(nextId);
    setError(null);
    const scenario = getScenarioById(nextId);
    if (scenario && nextId !== "custom") {
      setForm({ ...scenario.form });
    } else if (nextId === "custom") {
      setForm(emptyCustomForm());
    }
  }

  function updateForm<K extends keyof DemoCaseForm>(key: K, value: DemoCaseForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function onSubmit(
    event: React.FormEvent,
    target: "watch" | "step" = "watch"
  ) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const payload =
      scenarioId === "custom"
        ? { form }
        : {
            scenarioId,
            overrides: {
              subject: form.subject,
              description: form.description,
              priority: form.priority,
              shipTo: form.shipTo
            }
          };

    try {
      const response = await fetch("/api/demo/cases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const text = await response.text();
      let data: CreateResponse & { message?: string; error?: string };
      try {
        data = JSON.parse(text) as CreateResponse & {
          message?: string;
          error?: string;
        };
      } catch {
        throw new Error("Unexpected response from demo Case create.");
      }

      if (!response.ok) {
        const payload = data as { message?: string | string[] };
        const message = Array.isArray(payload.message)
          ? payload.message.join(" ")
          : payload.message;
        throw new Error(message ?? "Could not create the demo Case.");
      }

      router.push(
        target === "step"
          ? data.steppedOrchestrationUrl
          : data.orchestrationUrl
      );
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Could not create the demo Case."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void onSubmit(event, "watch")}
      className="grid gap-6 lg:grid-cols-[1fr_1.1fr]"
    >
      <div className="space-y-4">
        <Card className="border-primary/20 bg-card/80 backdrop-blur">
          <CardHeader>
            <CardTitle>Choose a scenario</CardTitle>
            <CardDescription>
              Pre-built Cases grounded in live org inventory and proven
              orchestrator paths.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="scenario">Scenario</Label>
              <select
                id="scenario"
                aria-label="Scenario"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={scenarioId}
                onChange={(event) => onScenarioChange(event.target.value)}
              >
                {scenarios.map((scenario) => (
                  <option key={scenario.id} value={scenario.id}>
                    {scenario.label}
                  </option>
                ))}
              </select>
            </div>

            {selectedScenario ? (
              <div className="space-y-3 rounded-lg border bg-muted/40 p-4">
                <p className="text-sm text-muted-foreground">
                  {selectedScenario.shortDescription}
                </p>
                {selectedScenario.story ? (
                  <p className="text-sm leading-relaxed">{selectedScenario.story}</p>
                ) : null}
                {selectedScenario.badges ? (
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(selectedScenario.badges).map(
                      ([key, value]) => (
                        <Badge key={key} variant="secondary">
                          {key}: {value}
                        </Badge>
                      )
                    )}
                  </div>
                ) : null}
                {selectedScenario.expectedOutcome?.summary ? (
                  <p className="text-sm font-medium text-foreground">
                    Expected: {selectedScenario.expectedOutcome.summary}
                  </p>
                ) : null}
                {selectedScenario.inventoryBasis?.parts ? (
                  <div className="flex flex-wrap gap-2">
                    {selectedScenario.inventoryBasis.parts.map((part) => (
                      <Badge key={`${part.code}-${part.warehouse}`} variant="outline">
                        {part.code} @ {part.warehouse} ({part.qty})
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Lookup summary</CardTitle>
            <CardDescription>
              Salesforce Ids are resolved server-side — never exposed here.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <span className="text-muted-foreground">Account:</span>{" "}
              {form.accountLookup.name}
            </p>
            {form.contactLookup?.email ? (
              <p>
                <span className="text-muted-foreground">Contact:</span>{" "}
                {form.contactLookup.email}
              </p>
            ) : null}
            <p>
              <span className="text-muted-foreground">Asset serial:</span>{" "}
              {form.assetLookup.serialNumber}
            </p>
            <p>
              <span className="text-muted-foreground">Ship-to:</span>{" "}
              {form.shipTo.city}, {form.shipTo.state}, {form.shipTo.country}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Case details</CardTitle>
          <CardDescription>
            Edit before submit. Only list spare part codes you want Node 4 to
            plan.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="subject">Subject</Label>
            <Input
              id="subject"
              value={form.subject}
              onChange={(event) => updateForm("subject", event.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={form.description}
              onChange={(event) => updateForm("description", event.target.value)}
              rows={8}
              required
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="priority">Priority</Label>
              <select
                id="priority"
                aria-label="Priority"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.priority}
                onChange={(event) => updateForm("priority", event.target.value)}
              >
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ship-city">Ship-to city</Label>
              <Input
                id="ship-city"
                value={form.shipTo.city}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    shipTo: { ...current.shipTo, city: event.target.value }
                  }))
                }
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ship-state">State</Label>
              <Input
                id="ship-state"
                value={form.shipTo.state}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    shipTo: { ...current.shipTo, state: event.target.value }
                  }))
                }
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ship-country">Country</Label>
              <Input
                id="ship-country"
                value={form.shipTo.country}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    shipTo: { ...current.shipTo, country: event.target.value }
                  }))
                }
                required
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Button type="submit" size="lg" disabled={submitting}>
              {submitting ? "Creating Case…" : "Create case & watch workflow →"}
            </Button>
            <Button
              type="button"
              size="lg"
              variant="secondary"
              disabled={submitting}
              onClick={(event) => void onSubmit(event, "step")}
            >
              {submitting ? "Creating Case…" : "Create case & step through →"}
            </Button>
            <Button type="button" variant="outline" asChild>
              <Link href="/orchestration">Open orchestration console</Link>
            </Button>
            <Button type="button" variant="outline" asChild>
              <Link href="/orchestration/stepped">Open stepped console</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
