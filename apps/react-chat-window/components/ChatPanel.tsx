"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import {
  AlertTriangle,
  LifeBuoy,
  Loader2,
  LogOut,
  RotateCcw,
  Send
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  EscalationDialog,
  type EscalationInput
} from "@/components/EscalationDialog";
import type { CustomerChatSession } from "@/components/LoginCard";

interface ChatPanelProps {
  brandName: string;
  brandSubtitle: string;
  session: CustomerChatSession;
  onSignOut(): void;
}

export function ChatPanel({
  brandName,
  brandSubtitle,
  session,
  onSignOut
}: ChatPanelProps) {
  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    status,
    error,
    reload,
    stop,
    setInput
  } = useChat({
    api: "/api/chat",
    streamProtocol: "text",
    headers: { Authorization: `Bearer ${session.accessToken}` },
    onError() {
      // Errors are surfaced via `error` below. No raw prompt/PII
      // is sent to telemetry from the browser.
    }
  });

  const [escalationOpen, setEscalationOpen] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  const isStreaming = status === "streaming" || status === "submitted";
  const showEmpty = messages.length === 0 && !isStreaming;

  function onComposerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (input.trim() && !isStreaming) {
        handleSubmit();
      }
    }
  }

  return (
    <main className="flex min-h-screen w-full items-stretch justify-center bg-gradient-to-br from-slate-50 to-slate-200 px-4 py-6 dark:from-slate-950 dark:to-slate-900">
      <div className="flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl border bg-card shadow-xl">
        <header className="flex items-start justify-between gap-3 border-b bg-card/95 px-6 py-4 backdrop-blur">
          <div className="space-y-1">
            <h1 className="text-lg font-semibold tracking-tight">
              {brandName}
            </h1>
            <p className="text-xs text-muted-foreground">
              {session.expiresAt
                ? `Session active until ${new Date(session.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                : brandSubtitle}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setEscalationOpen(true)}
              aria-label="Talk to a support specialist"
            >
              <LifeBuoy className="h-4 w-4" />
              Talk to support
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onSignOut}
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </Button>
          </div>
        </header>

        <section
          ref={listRef}
          role="log"
          aria-live="polite"
          aria-busy={isStreaming}
          className="flex-1 overflow-y-auto px-6 py-6 min-h-[420px] max-h-[60vh] space-y-4"
        >
          {showEmpty ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
              <p className="text-base font-medium text-foreground">
                How can we help today?
              </p>
              <p>
                Ask about your account, an order, or a recent support ticket.
              </p>
            </div>
          ) : null}

          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              role={message.role === "user" ? "user" : "assistant"}
              content={messageContent(message)}
            />
          ))}

          {status === "submitted" ? (
            <div
              aria-label="Assistant is preparing a response"
              className="flex items-center gap-2 text-xs text-muted-foreground"
            >
              <Loader2 className="h-3 w-3 animate-spin" /> Thinking…
            </div>
          ) : null}
        </section>

        {error ? (
          <Alert variant="destructive" className="mx-6 mb-3">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="flex items-center justify-between gap-3">
              <span>
                Something went wrong sending your message. Please try again.
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void reload()}
              >
                <RotateCcw className="h-3 w-3" /> Retry
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!input.trim() || isStreaming) return;
            handleSubmit();
          }}
          className="border-t bg-card px-6 py-4"
        >
          <div className="flex items-end gap-2">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={onComposerKeyDown}
              placeholder="Type your message…"
              aria-label="Type your message"
              rows={2}
              disabled={status === "submitted"}
            />
            {isStreaming ? (
              <Button type="button" variant="secondary" onClick={() => stop()}>
                Stop
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={!input.trim()}
                aria-label="Send message"
              >
                <Send className="h-4 w-4" />
                Send
              </Button>
            )}
          </div>
        </form>
      </div>

      <EscalationDialog
        open={escalationOpen}
        onOpenChange={setEscalationOpen}
        authToken={session.accessToken}
        conversationSummary={() => summarizeConversation(messages)}
        onSubmitted={() => setInput("")}
      />
    </main>
  );
}

function MessageBubble({
  role,
  content
}: {
  role: "user" | "assistant";
  content: string;
}) {
  const isUser = role === "user";
  return (
    <div
      className={`flex w-full ${isUser ? "justify-end" : "justify-start"} animate-fade-in`}
    >
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${
          isUser
            ? "bg-primary text-primary-foreground rounded-br-sm"
            : "bg-secondary text-secondary-foreground rounded-bl-sm"
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap break-words">{content || "…"}</p>
        ) : (
          <div className="space-y-2 break-words [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-background/80 [&_code]:px-1 [&_code]:py-0.5 [&_li]:pl-1 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-background/80 [&_pre]:p-3 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {content || "…"}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

interface AnyMessage {
  content?: string;
  parts?: Array<{ type?: string; text?: string }>;
}

function messageContent(message: AnyMessage): string {
  if (typeof message.content === "string" && message.content.length > 0) {
    return message.content;
  }
  if (Array.isArray(message.parts)) {
    return message.parts
      .filter((p) => p && p.type === "text" && typeof p.text === "string")
      .map((p) => p.text as string)
      .join("");
  }
  return "";
}

function summarizeConversation(
  messages: ReadonlyArray<{
    role: string;
    content?: string;
    parts?: AnyMessage["parts"];
  }>
): string {
  return messages
    .slice(-10)
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => `${m.role}: ${messageContent(m as AnyMessage)}`)
    .join("\n")
    .slice(0, 2000);
}

// Re-export type for parents.
export type { EscalationInput };
