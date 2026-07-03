"use client";

import { useMemo, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  salesforceCaseUrl?: string;
  orchestrationUrl: string;
}

interface CreatedCase {
  caseId: string;
  caseNumber?: string;
  salesforceCaseUrl?: string;
}

export function DemoCaseCreateForm({ scenarios }: DemoCaseCreateFormProps) {
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
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activateError, setActivateError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedCase | null>(null);

  // Existing-case activation state
  const [existingCaseNumber, setExistingCaseNumber] = useState("");
  const [activatingExisting, setActivatingExisting] = useState(false);
  const [existingActivateError, setExistingActivateError] = useState<string | null>(null);
  const [existingWorkflowId, setExistingWorkflowId] = useState<string | null>(null);

  const selectedScenario = useMemo(
    () => scenarios.find((scenario) => scenario.id === scenarioId),
    [scenarioId, scenarios]
  );

  function onScenarioChange(nextId: string) {
    setScenarioId(nextId);
    setError(null);
    setActivateError(null);
    setCreated(null);
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

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setActivateError(null);
    setCreated(null);

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

      const nextCreated: CreatedCase = {
        caseId: data.caseId,
        caseNumber: data.caseNumber,
        salesforceCaseUrl: data.salesforceCaseUrl
      };
      setCreated(nextCreated);

      if (data.salesforceCaseUrl?.startsWith("http")) {
        window.open(data.salesforceCaseUrl, "_blank", "noopener,noreferrer");
      }
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

  async function activateAgent() {
    if (!created) return;
    setActivating(true);
    setActivateError(null);

    try {
      const response = await fetch(
        `/api/orchestrator/case/${encodeURIComponent(created.caseId)}/stepped`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            caseId: created.caseId,
            caseNumber: created.caseNumber
          })
        }
      );
      const text = await response.text();
      let data: { workflowId?: string; message?: string; error?: string };
      try {
        data = JSON.parse(text) as {
          workflowId?: string;
          message?: string;
          error?: string;
        };
      } catch {
        throw new Error("Unexpected response from agent activation.");
      }

      if (!response.ok) {
        throw new Error(
          data.message ?? "Could not activate the agent for this Case."
        );
      }
      if (!data.workflowId) {
        throw new Error("Agent activation did not return a workflow id.");
      }

      const url = `/orchestration/stepped?workflowId=${encodeURIComponent(
        data.workflowId
      )}`;
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (activateErr) {
      setActivateError(
        activateErr instanceof Error
          ? activateErr.message
          : "Could not activate the agent."
      );
    } finally {
      setActivating(false);
    }
  }

  async function activateExistingCase() {
    const caseNumber = existingCaseNumber.trim();
    if (!caseNumber) return;

    if (!/^\d{1,20}$/.test(caseNumber)) {
      setExistingActivateError(
        "Enter a numeric Salesforce Case Number (e.g. 00001079)."
      );
      return;
    }

    setActivatingExisting(true);
    setExistingActivateError(null);
    setExistingWorkflowId(null);

    try {
      const response = await fetch("/api/demo/activate-existing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ caseNumber })
      });
      const text = await response.text();
      let data: { workflowId?: string; message?: string; error?: string };
      try {
        data = JSON.parse(text) as {
          workflowId?: string;
          message?: string;
          error?: string;
        };
      } catch {
        throw new Error("Unexpected response from agent activation.");
      }

      if (!response.ok) {
        throw new Error(data.message ?? "Could not activate the agent for this Case.");
      }
      if (!data.workflowId) {
        throw new Error("Agent activation did not return a workflow id.");
      }

      setExistingWorkflowId(data.workflowId);
      const url = `/orchestration/stepped?workflowId=${encodeURIComponent(data.workflowId)}`;
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setExistingActivateError(
        err instanceof Error ? err.message : "Could not activate the agent."
      );
    } finally {
      setActivatingExisting(false);
    }
  }

  return (
    <>
    <form onSubmit={onSubmit} className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
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
          {created ? (
            <Alert className="border-green-600/40 bg-green-50 text-green-950 dark:bg-green-950/20 dark:text-green-50">
              <AlertTitle>Case created in Salesforce</AlertTitle>
              <AlertDescription className="space-y-2">
                <p>
                  Case{" "}
                  <strong>{created.caseNumber ?? created.caseId}</strong> was
                  created successfully. We opened it in a new browser tab.
                </p>
                <p>
                  Click <strong>Activate agent</strong> to assign this Case to
                  the orchestrator. In the stepped console, use{" "}
                  <strong>Run Triage</strong> when you are ready to start the
                  first stage manually.
                </p>
                {created.salesforceCaseUrl ? (
                  <p>
                    <a
                      href={created.salesforceCaseUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium underline underline-offset-2"
                    >
                      Open Case in Salesforce again
                    </a>
                  </p>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {activateError ? (
            <Alert variant="destructive">
              <AlertDescription>{activateError}</AlertDescription>
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
              {submitting ? "Creating Case…" : "Create case in Salesforce"}
            </Button>
            <Button
              type="button"
              size="lg"
              variant="default"
              disabled={!created || activating}
              onClick={() => void activateAgent()}
            >
              {activating ? "Activating…" : "Activate agent"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>

    {/* Existing-case activation */}
    <div className="mt-8">
      <div className="relative mb-6">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-muted-foreground">
            or activate an existing case
          </span>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Activate existing case</CardTitle>
          <CardDescription>
            Already have a Case in Salesforce (e.g. created by the landing page
            chat)? Enter its Case Number to assign it to the orchestrator —
            same as clicking <strong>Activate agent</strong> after creating a
            case above.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {existingWorkflowId ? (
            <Alert className="border-green-600/40 bg-green-50 text-green-950 dark:bg-green-950/20 dark:text-green-50">
              <AlertTitle>Agent activated</AlertTitle>
              <AlertDescription className="space-y-2">
                <p>
                  The orchestrator is running for this Case. We opened the
                  stepped console in a new tab.
                </p>
                <p>
                  <a
                    href={`/orchestration/stepped?workflowId=${encodeURIComponent(existingWorkflowId)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium underline underline-offset-2"
                  >
                    Open stepped console again
                  </a>
                </p>
              </AlertDescription>
            </Alert>
          ) : null}

          {existingActivateError ? (
            <Alert variant="destructive">
              <AlertDescription>{existingActivateError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="existing-case-number">Case Number</Label>
            <p className="text-xs text-muted-foreground">
              The numeric Case Number shown in Salesforce or in the landing page
              chat, e.g.{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono">
                00001079
              </code>
            </p>
            <Input
              id="existing-case-number"
              placeholder="00001079"
              value={existingCaseNumber}
              onChange={(event) => {
                setExistingCaseNumber(event.target.value.replace(/\D/g, ""));
                setExistingActivateError(null);
                setExistingWorkflowId(null);
              }}
              maxLength={20}
              inputMode="numeric"
              className="font-mono"
            />
          </div>

          <Button
            type="button"
            size="lg"
            variant="default"
            disabled={!existingCaseNumber.trim() || activatingExisting}
            onClick={() => void activateExistingCase()}
          >
            {activatingExisting ? "Looking up & activating…" : "Activate agent"}
          </Button>
        </CardContent>
      </Card>
    </div>
    </>
  );
}
