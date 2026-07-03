"use client";

import { useEffect, useRef, useState } from "react";
import { Laptop, Loader2, Send } from "lucide-react";

import type { IntakeDevice, IntakeMessage } from "@/lib/intake-flow";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

interface IntakeConversationProps {
  displayName?: string;
  messages: IntakeMessage[];
  devices: IntakeDevice[];
  selectedAssetId: string | null;
  /** Device the model believes the customer named; highlighted for one-tap confirm. */
  suggestedAssetId?: string | null;
  issueCaptured: boolean;
  showDevicePicker: boolean;
  sending: boolean;
  reviewReady: boolean;
  error: string | null;
  onSend(text: string): void;
  onSelectDevice(assetId: string): void;
  onClearDevice(): void;
  onReview(): void;
}

export function IntakeConversation({
  displayName,
  messages,
  devices,
  selectedAssetId,
  suggestedAssetId = null,
  issueCaptured,
  showDevicePicker,
  sending,
  reviewReady,
  error,
  onSend,
  onSelectDevice,
  onClearDevice,
  onReview
}: IntakeConversationProps) {
  const [input, setInput] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages, sending]);

  function submit() {
    const text = input.trim();
    if (!text || sending) return;
    onSend(text);
    setInput("");
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-4 px-4 py-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">
          {displayName ? `Hi ${displayName}, ` : ""}how can we help you today?
        </h1>
        <p className="text-sm text-muted-foreground">
          Describe the issue first — we&apos;ll ask which device is affected when
          we have enough detail.
        </p>
      </header>

      <div
        ref={logRef}
        className="flex-1 space-y-3 overflow-y-auto rounded-lg border bg-card p-4"
      >
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Tell us what&apos;s going on and we&apos;ll help you get started.
          </p>
        ) : null}
        {messages.map((message, index) => (
          <div
            key={index}
            className={cn(
              "max-w-[85%] rounded-lg px-3 py-2 text-sm",
              message.role === "user"
                ? "ml-auto bg-primary text-primary-foreground"
                : "bg-muted"
            )}
          >
            {message.content}
          </div>
        ))}
        {sending ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Thinking…
          </div>
        ) : null}
      </div>

      {error ? (
        <Alert variant="destructive" role="alert" aria-live="polite">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex items-end gap-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="e.g. My screen flickers and then goes black on startup"
          rows={2}
          disabled={sending}
          aria-label="Describe your issue"
        />
        <Button
          type="button"
          onClick={submit}
          disabled={sending || input.trim().length === 0}
        >
          <Send className="h-4 w-4" />
          Send
        </Button>
      </div>

      {showDevicePicker ? (
        <section className="space-y-2 rounded-lg border bg-card p-4">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <Laptop className="h-4 w-4" />
            {suggestedAssetId
              ? "Tap to confirm the affected device"
              : "Which device is affected?"}
          </h2>
          <div className="flex flex-wrap gap-2">
            {[...devices]
              .sort((a, b) =>
                a.assetId === suggestedAssetId
                  ? -1
                  : b.assetId === suggestedAssetId
                    ? 1
                    : 0
              )
              .map((device) => {
              const suggested = device.assetId === suggestedAssetId;
              return (
                <Button
                  key={device.assetId}
                  type="button"
                  variant={suggested ? "default" : "outline"}
                  size="sm"
                  disabled={sending}
                  onClick={() => onSelectDevice(device.assetId)}
                >
                  {suggested ? `✓ ${device.label}` : device.label}
                </Button>
              );
            })}
          </div>
        </section>
      ) : null}

      {issueCaptured && devices.length === 0 ? (
        <section className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">
            No devices are on file for your account — you can still submit the
            issue.
          </p>
        </section>
      ) : null}

      {selectedAssetId ? (
        <section className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-4 text-sm">
          <span className="font-medium text-muted-foreground">Device:</span>
          <span className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
            {devices.find((device) => device.assetId === selectedAssetId)?.label}
          </span>
          {devices.length > 1 ? (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 text-muted-foreground"
              onClick={onClearDevice}
            >
              Change
            </Button>
          ) : null}
        </section>
      ) : null}

      <Button
        type="button"
        size="lg"
        className="w-full"
        onClick={onReview}
        disabled={!reviewReady || sending}
      >
        Review &amp; submit
      </Button>
    </main>
  );
}
