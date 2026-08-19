import pino from "pino";
import { config } from "./config.js";

// scrubSecrets removes secret material that appears INSIDE strings — pino's
// path-based redaction only matches object keys, so an apikey or seed embedded
// in an error message/stack (e.g. a failed bundler URL) would otherwise pass
// through. Used both for logs and for any error text shown to the user.
export function scrubSecrets(input: string): string {
  return input
    // apikey=... / apiKey: ... / api_key=... in URLs or text
    .replace(/(api[_-]?key["'\s:=]+)[A-Za-z0-9._-]+/gi, "$1[REDACTED]")
    // whole query strings on api.pimlico.io / bundler URLs
    .replace(/(https?:\/\/[^\s"']*\?)[^\s"']*/gi, "$1[REDACTED]")
    // bearer tokens
    .replace(/(bearer\s+)[A-Za-z0-9._-]+/gi, "$1[REDACTED]")
    // seed/mnemonic/private-key labelled in a message. NOT bare 64-hex (that
    // would clobber transaction hashes) and NOT bare word-runs (that would
    // clobber legitimate long messages) — only clearly-labelled secrets.
    .replace(/(seed|mnemonic|private[_-]?key)["'\s:=]+[^\n,"']{8,}/gi, "$1: [REDACTED]");
}

// deepScrub walks string values at any nesting depth (pino's key redaction
// covers one level; the old formatter covered only top-level strings, so a
// nested MCP error payload could pass through unscrubbed). Errors are reduced
// to name + scrubbed message with no stack; depth/array caps keep it cheap.
function deepScrub(value: unknown, depth: number): unknown {
  if (depth > 4) return "[depth-capped]";
  if (typeof value === "string") return scrubSecrets(value);
  if (value instanceof Error) return { name: value.name, message: scrubSecrets(value.message) };
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => deepScrub(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>)) {
      out[k] = deepScrub((value as Record<string, unknown>)[k], depth + 1);
    }
    return out;
  }
  return value;
}

const root = pino({
  level: config.logLevel,
  redact: {
    paths: [
      "seed", "*.seed", "WDK_SEED", "*.WDK_SEED",
      "privateKey", "*.privateKey", "keyPair", "*.keyPair",
    ],
    censor: "[REDACTED]",
  },
  // Scrub secrets that live inside string values (messages, stacks, URLs).
  formatters: {
    log(obj: Record<string, unknown>) {
      return deepScrub(obj, 0) as Record<string, unknown>;
    },
  },
});

export function getLogger(name: string) {
  return root.child({ module: name });
}
