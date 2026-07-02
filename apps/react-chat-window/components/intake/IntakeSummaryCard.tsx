"use client";

import { ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface IntakeSummaryCardProps {
  subject: string;
  description: string;
  priority: string;
  deviceLabel?: string;
  shipTo: { city?: string; state?: string; country?: string };
  submitting: boolean;
  error: string | null;
  onBack(): void;
  onSubmit(): void;
}

function formatShipTo(shipTo: {
  city?: string;
  state?: string;
  country?: string;
}): string | null {
  const parts = [shipTo.city, shipTo.state, shipTo.country].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

export function IntakeSummaryCard({
  subject,
  description,
  priority,
  deviceLabel,
  shipTo,
  submitting,
  error,
  onBack,
  onSubmit
}: IntakeSummaryCardProps) {
  const shipToLine = formatShipTo(shipTo);

  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-gradient-to-br from-slate-50 to-slate-200 px-4 py-12 dark:from-slate-950 dark:to-slate-900">
      <Card className="w-full max-w-lg animate-fade-in">
        <CardHeader>
          <CardTitle className="text-2xl">Review your case</CardTitle>
          <CardDescription>
            Confirm the details below and we&apos;ll create your support case.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <SummaryRow label="Subject" value={subject} />
          <SummaryRow label="Description" value={description} multiline />
          <SummaryRow label="Priority" value={priority} />
          <SummaryRow label="Device" value={deviceLabel ?? "Not specified"} />
          {shipToLine ? (
            <SummaryRow label="Ship to" value={shipToLine} />
          ) : null}
          {error ? (
            <Alert variant="destructive" role="alert" aria-live="polite">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
        <CardFooter className="flex-col gap-2">
          <Button
            type="button"
            size="lg"
            className="w-full"
            onClick={onSubmit}
            disabled={submitting}
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating case…
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" />
                Create support case
              </>
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={onBack}
            disabled={submitting}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to conversation
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}

function SummaryRow({
  label,
  value,
  multiline
}: {
  label: string;
  value: string;
  multiline?: boolean;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={multiline ? "whitespace-pre-wrap" : undefined}>{value}</p>
    </div>
  );
}
