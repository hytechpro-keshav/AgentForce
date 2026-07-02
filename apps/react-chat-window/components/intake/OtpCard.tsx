"use client";

import { useState } from "react";
import { ArrowLeft, Loader2, ShieldCheck } from "lucide-react";

import type { IntakeSession } from "@/lib/intake-flow";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface OtpCardProps {
  email: string;
  onVerified(session: IntakeSession): void;
  onBack(): void;
}

export function OtpCard({ email, onVerified, onBack }: OtpCardProps) {
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = code.trim();
    if (!value) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/intake/otp/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, code: value })
      });
      const json = (await res.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (!res.ok) {
        setError(
          res.status === 429
            ? "Too many attempts. Please wait a moment and try again."
            : "That code is invalid or has expired. Please try again."
        );
        return;
      }
      const accessToken = String(json.accessToken ?? "");
      if (!accessToken) {
        setError("Verification failed. Please request a new code.");
        return;
      }
      onVerified({
        accessToken,
        expiresAt: String(json.expiresAt ?? ""),
        subject: String(json.subject ?? "customer-intake-session")
      });
    } catch {
      setError(
        "Could not reach the service. Please check your connection and try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-gradient-to-br from-slate-50 to-slate-200 px-4 py-12 dark:from-slate-950 dark:to-slate-900">
      <Card className="w-full max-w-md animate-fade-in">
        <CardHeader>
          <CardTitle className="text-2xl">Enter your code</CardTitle>
          <CardDescription>
            We sent a verification code to {email}.
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit} noValidate>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="intake-otp">Verification code</Label>
              <Input
                id="intake-otp"
                name="intake-otp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                spellCheck={false}
                placeholder="6-digit code"
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 8))
                }
                disabled={submitting}
                required
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "intake-otp-error" : undefined}
              />
            </div>
            {error ? (
              <Alert
                variant="destructive"
                id="intake-otp-error"
                role="alert"
                aria-live="polite"
              >
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
          <CardFooter className="flex-col gap-2">
            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={submitting || code.trim().length < 4}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Verifying…
                </>
              ) : (
                <>
                  <ShieldCheck className="h-4 w-4" />
                  Verify and continue
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
              Use a different email
            </Button>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}
