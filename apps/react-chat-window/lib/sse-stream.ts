/**
 * Transforms the NestJS `/chat/message/stream` SSE event stream
 *   data: {"type":"text","value":"..."}
 *   data: {"type":"done", ... }
 *   data: [DONE]
 * into a flat UTF-8 text stream consumable by the Vercel AI SDK
 * `text` stream protocol. Done/error events terminate the stream.
 *
 * This module is server-only but framework-agnostic so it can be
 * unit-tested without loading `next/server`.
 */
export function transformSseToText(
  source: ReadableStream<Uint8Array>
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = source.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let separator = buffer.indexOf("\n\n");
          while (separator !== -1) {
            const rawEvent = buffer.slice(0, separator);
            buffer = buffer.slice(separator + 2);
            separator = buffer.indexOf("\n\n");

            const dataLines = rawEvent
              .split("\n")
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trimStart());
            if (dataLines.length === 0) continue;
            const data = dataLines.join("\n");
            if (data === "[DONE]") {
              controller.close();
              return;
            }
            let parsed: { type?: string; value?: string };
            try {
              parsed = JSON.parse(data) as {
                type?: string;
                value?: string;
              };
            } catch {
              continue;
            }
            if (parsed.type === "text" && typeof parsed.value === "string") {
              controller.enqueue(encoder.encode(parsed.value));
            } else if (parsed.type === "error") {
              controller.close();
              return;
            }
            // 'done' frames are server-only telemetry; the browser
            // does not need usage/cost in the streaming UI.
          }
        }
      } catch {
        // Stream interrupted — finalize cleanly so the UI can retry.
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
        try {
          reader.releaseLock();
        } catch {
          /* ignore */
        }
      }
    }
  });
}
