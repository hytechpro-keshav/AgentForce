import type {
  LlmChatRequest,
  LlmMessage
} from "../llm/interfaces/llm-contracts";

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const CREDIT_CARD_PATTERN = /\b(?:\d[ -]?){13,19}\b/g;
const SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/g;
const PHONE_PATTERN = /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?){2}\d{4}\b/g;
const STREET_ADDRESS_PATTERN =
  /\b\d{1,6}\s+[A-Z0-9.'-]+(?:\s+[A-Z0-9.'-]+){0,5}\s+(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|circle|cir|way|place|pl)\b(?:[.,]?\s*(?:apt|apartment|unit|suite|ste|#)\s*[A-Z0-9-]+)?/gi;
const LABELED_IDENTIFIER_PATTERN =
  /\b(?:account|customer|contact|case|order|invoice|policy|subscription|member)\s*(?:id|number|no|#|:|-)\s*[A-Z0-9][A-Z0-9_.-]{4,}\b/gi;
const SALESFORCE_ID_PATTERN =
  /\b(?:001|003|005|006|00D|00Q|00T|500|501|701|a0[A-Z0-9])[A-Z0-9]{12}(?:[A-Z0-9]{3})?\b/gi;
const LONG_NUMBER_PATTERN = /\b\d{6,}\b/g;
const LABELED_NAME_PATTERN =
  /\b((?:(?:my|My|customer|Customer|contact|Contact|caller|Caller|account holder|Account holder|policyholder|Policyholder)\s+name\s*(?:is|:)?|(?:name|Name)\s*:)\s+)[A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z'\-]+){0,2}\b/g;
const CONTEXTUAL_NAME_PATTERN =
  /\b((?:for|For|from|From|by|By|tell|Tell|customer|Customer|contact|Contact|caller|Caller)\s+)[A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z'\-]+){1,2}\b/g;

export function redactSensitiveText(value: string): string {
  return value
    .replace(EMAIL_PATTERN, "[redacted-email]")
    .replace(CREDIT_CARD_PATTERN, "[redacted-payment]")
    .replace(SSN_PATTERN, "[redacted-ssn]")
    .replace(STREET_ADDRESS_PATTERN, "[redacted-address]")
    .replace(PHONE_PATTERN, "[redacted-phone]")
    .replace(LABELED_IDENTIFIER_PATTERN, "[redacted-identifier]")
    .replace(SALESFORCE_ID_PATTERN, "[redacted-salesforce-id]")
    .replace(LONG_NUMBER_PATTERN, "[redacted-number]")
    .replace(LABELED_NAME_PATTERN, "$1[redacted-name]")
    .replace(CONTEXTUAL_NAME_PATTERN, "$1[redacted-name]");
}

export function redactLlmMessages(messages: LlmMessage[]): LlmMessage[] {
  return messages.map((message) => ({
    ...message,
    content: redactSensitiveText(message.content)
  }));
}

export function redactLlmChatRequest(request: LlmChatRequest): LlmChatRequest {
  return {
    ...request,
    messages: redactLlmMessages(request.messages)
  };
}
