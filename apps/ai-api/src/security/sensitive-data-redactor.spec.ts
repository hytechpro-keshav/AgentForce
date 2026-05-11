import {
  redactLlmChatRequest,
  redactSensitiveText
} from "./sensitive-data-redactor";

describe("sensitive data redactor", () => {
  it("masks common customer identifiers while preserving issue context", () => {
    const raw = [
      "Customer name is Jane Doe.",
      "Email jane.doe@example.com and phone 415-555-1212.",
      "Account number ACCT-123456 and Case 00001029.",
      "Card 4111 1111 1111 1111, SSN 123-45-6789.",
      "Service address 123 Main St Apt 4B has no internet."
    ].join(" ");

    const redacted = redactSensitiveText(raw);

    expect(redacted).toContain("[redacted-name]");
    expect(redacted).toContain("[redacted-email]");
    expect(redacted).toContain("[redacted-phone]");
    expect(redacted).toContain("[redacted-identifier]");
    expect(redacted).toContain("[redacted-payment]");
    expect(redacted).toContain("[redacted-ssn]");
    expect(redacted).toContain("[redacted-address]");
    expect(redacted).toContain("has no internet");
    expect(redacted).not.toContain("Jane Doe");
    expect(redacted).not.toContain("jane.doe@example.com");
    expect(redacted).not.toContain("415-555-1212");
    expect(redacted).not.toContain("ACCT-123456");
    expect(redacted).not.toContain("4111 1111 1111 1111");
    expect(redacted).not.toContain("123 Main St");
  });

  it("masks LLM chat request message content without changing routing fields", () => {
    const request = redactLlmChatRequest({
      provider: "openai",
      model: "gpt-4o-mini",
      requestId: "safe-request-id",
      messages: [
        { role: "system", content: "Return JSON only." },
        {
          role: "user",
          content:
            "Name: Jane Doe. Email jane@example.com. Phone 415-555-1212. Issue still happens."
        }
      ]
    });

    expect(request.provider).toBe("openai");
    expect(request.model).toBe("gpt-4o-mini");
    expect(request.requestId).toBe("safe-request-id");
    expect(request.messages[0].content).toBe("Return JSON only.");
    expect(request.messages[1].content).toContain("[redacted-name]");
    expect(request.messages[1].content).toContain("[redacted-email]");
    expect(request.messages[1].content).toContain("[redacted-phone]");
    expect(request.messages[1].content).toContain("Issue still happens.");
  });
});
