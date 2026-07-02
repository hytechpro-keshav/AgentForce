"use client";

import { useState } from "react";
import { Loader2, Mail } from "lucide-react";

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

interface EmailCardProps {
  brandName: string;
  brandSubtitle: string;
  onSent(email: string): void;
}

export function EmailCard({
  brandName,
  brandSubtitle,
  onSent
}: EmailCardProps) {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = email.trim();
    if (!value) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/intake/otp/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: value })
      });
      if (!res.ok && res.status !== 200) {
        setError(
          res.status === 429
            ? "Too many attempts. Please wait a moment and try again."
            : "We couldn't start verification. Please check your email and try again."
        );
        return;
      }
      // Response is intentionally uniform; advance to the code step regardless.
      onSent(value.toLowerCase());
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
          <CardTitle className="text-2xl">{brandName}</CardTitle>
          <CardDescription>{brandSubtitle}</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit} noValidate>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="intake-email">Email address</Label>
              <Input
                id="intake-email"
                name="intake-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
                required
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "intake-email-error" : undefined}
              />
            </div>
            {error ? (
              <Alert
                variant="destructive"
                id="intake-email-error"
                role="alert"
                aria-live="polite"
              >
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <p className="text-xs text-muted-foreground">
              We&apos;ll email you a verification code to confirm your identity
              before creating a support case.
            </p>
          </CardContent>
          <CardFooter>
            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={submitting || email.trim().length === 0}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sending code…
                </>
              ) : (
                <>
                  <Mail className="h-4 w-4" />
                  Send verification code
                </>
              )}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}
