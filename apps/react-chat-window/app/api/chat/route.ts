import { NextRequest, NextResponse } from "next/server";

import { transformSseToText } from "@/lib/sse-stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function aiApiBaseUrl(): string {
  const url = process.env.AI_API_BASE_URL?.trim();
  if (!url) {
    throw new Error(
      "AI_API_BASE_URL is not configured on the react-chat-window service."
    );
  }
  return url.replace(/\/+$/, "");
}

interface IncomingChatBody {
  messages?: Array<{ role?: string; content?: string }>;
  requestId?: string;
}

const ALLOWED_ROLES = new Set(["system", "user", "assistant"]);

/**
 * Streaming chat proxy.
 *
 * - Accepts a Vercel AI SDK-style `useChat` POST body.
 * - Normalizes the message history to the NestJS `/chat/message/stream`
 *   DTO.
 * - Forwards the browser's `Authorization: Bearer <chat-token>` to
 *   NestJS unchanged.
 * - Pipes the upstream SSE stream into the response body as plain
 *   text deltas using the Vercel AI SDK `text` stream protocol so the
 *   browser renders tokens incrementally.
 *
 * The Next.js process never holds OpenAI, Anthropic, Pinecone, or
 * Salesforce credentials. Only NestJS owns those.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.toLowerCase().startsWith("bearer ")) {
    return NextResponse.json(
      { error: "unauthorized", message: "Sign in to start a chat." },
      { status: 401 }
    );
  }

  let body: IncomingChatBody;
  try {
    body = (await request.json()) as IncomingChatBody;
  } catch {
    return NextResponse.json(
      { error: "invalid_json", message: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  const rawMessages = Array.isArray(body.messages) ? body.messages : [];
  const messages = rawMessages
    .filter(
      (m): m is { role: string; content: string } =>
        !!m &&
        typeof m.role === "string" &&
        ALLOWED_ROLES.has(m.role) &&
        typeof m.content === "string" &&
        m.content.trim().length > 0
    )
    .map((m) => ({ role: m.role, content: m.content }));

  if (messages.length === 0) {
    return NextResponse.json(
      { error: "invalid_request", message: "Conversation cannot be empty." },
      { status: 400 }
    );
  }

  const requestId =
    typeof body.requestId === "string" && body.requestId.length <= 64
      ? body.requestId
      : `chat-${cryptoRandom()}`;

  let upstream: Response;
  try {
    upstream = await fetch(`${aiApiBaseUrl()}/chat/message/stream`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        authorization
      },
      body: JSON.stringify({ messages, requestId }),
      cache: "no-store"
    });
  } catch {
    return NextResponse.json(
      {
        error: "network_error",
        message:
          "Could not reach the chat service. Please check your connection."
      },
      { status: 502 }
    );
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return new Response(text || `{"error":"upstream_failed"}`, {
      status: upstream.status,
      headers: {
        "content-type":
          upstream.headers.get("content-type") ?? "application/json"
      }
    });
  }

  const textStream = transformSseToText(upstream.body);
  return new Response(textStream, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no"
    }
  });
}

function cryptoRandom(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
