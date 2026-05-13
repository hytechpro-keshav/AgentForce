"use client";

import { useState } from "react";
import { LogIn, Loader2 } from "lucide-react";

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

export interface CustomerChatSession {
  accessToken: string;
  expiresAt: string;
  subject: string;
}

interface LoginCardProps {
  brandName: string;
  brandSubtitle: string;
  onSession(session: CustomerChatSession): void;
}

export function LoginCard({
  brandName,
  brandSubtitle,
  onSession
}: LoginCardProps) {
  const [accessCode, setAccessCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = accessCode.trim();
    if (!code) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accessCode: code })
      });
      const json = (await res.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (!res.ok) {
        const code =
          typeof json.error === "string" ? json.error : "request_failed";
        setError(humanMessage(code, res.status));
        return;
      }
      const accessToken = String(json.accessToken ?? "");
      if (!accessToken) {
        setError("The chat service returned an empty token. Please try again.");
        return;
      }
      onSession({
        accessToken,
        expiresAt: String(json.expiresAt ?? ""),
        subject: String(json.subject ?? "customer-chat-session")
      });
    } catch {
      setError(
        "Could not reach the chat service. Please check your connection and try again."
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
              <Label htmlFor="access-code">Access code</Label>
              <Input
                id="access-code"
                name="access-code"
                type="text"
                inputMode="text"
                autoComplete="one-time-code"
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                placeholder="Enter the access code provided to you"
                value={accessCode}
                onChange={(e) => setAccessCode(e.target.value)}
                disabled={submitting}
                required
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "access-code-error" : undefined}
              />
            </div>
            {error ? (
              <Alert
                variant="destructive"
                id="access-code-error"
                role="alert"
                aria-live="polite"
              >
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Your access code is required to start a secure chat. Do not
              share it.
            </p>
          </CardContent>
          <CardFooter>
            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={submitting || accessCode.trim().length === 0}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Signing in…
                </>
              ) : (
                <>
                  <LogIn className="h-4 w-4" />
                  Continue
                </>
              )}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}

function humanMessage(code: string, status: number): string {
  switch (code) {
    case "customer_chat_login_failed":
      return "That access code did not work. Please check it and try again.";
    case "customer_chat_login_rate_limited":
      return "Too many login attempts. Please wait a moment and try again.";
    case "customer_chat_login_unavailable":
      return "Chat login is not available right now. Please try again later.";
    case "unauthorized":
      return "That access code did not work. Please check it and try again.";
    default:
      return `Could not sign in (status ${status}). Please try again.`;
  }
}
