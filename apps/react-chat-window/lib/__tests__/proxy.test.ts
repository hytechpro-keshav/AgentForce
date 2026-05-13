import { describe, expect, it } from "vitest";

import { transformSseToText } from "@/lib/sse-stream";
import { sanitizeSources } from "@/lib/sources";

function sourceFromString(input: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(input));
      controller.close();
    }
  });
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

describe("transformSseToText", () => {
  it("concatenates text deltas and ignores done frames", async () => {
    const sse = [
      'data: {"type":"text","value":"Hello"}',
      "",
      'data: {"type":"text","value":", world"}',
      "",
      'data: {"type":"done","usage":{"inputTokens":1,"outputTokens":2,"totalTokens":3}}',
      "",
      "data: [DONE]",
      "",
      ""
    ].join("\n");
    const out = await readAll(transformSseToText(sourceFromString(sse)));
    expect(out).toBe("Hello, world");
  });

  it("terminates on error events", async () => {
    const sse = [
      'data: {"type":"text","value":"Partial"}',
      "",
      'data: {"type":"error","status":502}',
      "",
      ""
    ].join("\n");
    const out = await readAll(transformSseToText(sourceFromString(sse)));
    expect(out).toBe("Partial");
  });
});

describe("sanitizeSources", () => {
  it("keeps customer-safe fields and drops unknown keys", () => {
    const result = sanitizeSources([
      {
        title: "Help article",
        url: "https://example.test/help",
        snippet: "Useful guidance",
        chunkId: "secret-id",
        salesforceId: "001xxx"
      }
    ]);
    expect(result).toEqual([
      {
        title: "Help article",
        url: "https://example.test/help",
        snippet: "Useful guidance"
      }
    ]);
  });

  it("rejects non-https urls and empty titles", () => {
    expect(
      sanitizeSources([
        { title: "ok", url: "javascript:alert(1)" },
        { title: "" },
        null,
        { url: "https://example.test/a" }
      ])
    ).toEqual([{ title: "ok" }]);
  });
});
