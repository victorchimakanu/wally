// Input sanitization runs before any LLM call.
//
// IMPORTANT: this is best-effort hygiene, NOT the fund-safety boundary. The
// real control against fund redirection is that the recipient address is taken
// only from the user's literal text or a verified address book, never from the
// model (see agent/index.ts). Treat the pattern list below as noise reduction
// and logging, not a security guarantee — blocklists are always bypassable.
//
// Order matters: we Unicode-normalize (NFKC) and strip zero-width / bidi
// characters BEFORE pattern-matching, so obfuscation like "ignore​previous"
// or homoglyph spacing cannot slip past the check and still reach the model.

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

  // Normalize and strip obfuscation BEFORE matching, and before the text can
  // reach the model: NFKC folds homoglyph/compatibility forms; the second
  // replace removes zero-width and bidi controls that defeat \s-based patterns.
  const normalized = input
    .normalize("NFKC")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(normalized)) {
      return { ok: false, reason: "Message contains disallowed content" };
    }
  }

  const cleaned = normalized.trim();
  if (!cleaned) {
    return { ok: false, reason: "Message is empty after cleaning" };
  }

  return { ok: true, cleaned };
}
