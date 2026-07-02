"use client";

import { CheckCircle2, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from "@/components/ui/card";

interface IntakeDoneProps {
  caseNumber: string | null;
  onRestart(): void;
}

export function IntakeDone({ caseNumber, onRestart }: IntakeDoneProps) {
  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-gradient-to-br from-slate-50 to-slate-200 px-4 py-12 dark:from-slate-950 dark:to-slate-900">
      <Card className="w-full max-w-md animate-fade-in text-center">
        <CardHeader>
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <CardTitle className="text-2xl">Case created</CardTitle>
          <CardDescription>
            {caseNumber
              ? `Your support case ${caseNumber} has been logged.`
              : "Your support case has been logged."}{" "}
            Our team will follow up with you by email.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          You can close this window. Thank you for reaching out.
        </CardContent>
        <CardFooter>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={onRestart}
          >
            <RotateCcw className="h-4 w-4" />
            Report another issue
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}
