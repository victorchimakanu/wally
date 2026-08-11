// Input sanitization runs before any LLM call.
// Wally handles financial operations, so prompt injection is a real attack
// surface: a malicious QR code or paste could attempt to redirect funds.

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(previous|prior|all|above)\s+(instructions?|prompts?)/i,
  /system\s+override/i,
  /you\s+are\s+now/i,
  /admin\s+mode/i,
  /as\s+an?\s+ai/i,
  /forget\s+(everything|all|your|prior)/i,
  /new\s+instruction/i,
  /act\s+as\s+(a\s+)?(?!wally)/i,
  /jailbreak/i,
  /\[system\]/i,
  /<\|?system\|?>/i,
  /<<SYS>>/i,
  /\[INST\]/i,
];

const MAX_MESSAGE_LENGTH = 1000;

export interface SanitizeResult {
  ok: boolean;
  reason?: string;
  cleaned?: string;
}

export function sanitize(input: string): SanitizeResult {
  if (!input || typeof input !== "string") {
    return { ok: false, reason: "Empty message" };
  }

  if (input.length > MAX_MESSAGE_LENGTH) {
    return {
      ok: false,
      reason: `Message too long (${input.length} chars, max ${MAX_MESSAGE_LENGTH})`,
    };
  }

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(input)) {
      return { ok: false, reason: "Message contains disallowed content" };
    }
  }

  // Strip any embedded null bytes or control characters (except newline/tab)
  const cleaned = input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim();

  if (!cleaned) {
    return { ok: false, reason: "Message is empty after cleaning" };
  }

  return { ok: true, cleaned };
}
