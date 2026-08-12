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
      for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (typeof v === "string") obj[k] = scrubSecrets(v);
        else if (v instanceof Error) {
          obj[k] = { name: v.name, message: scrubSecrets(v.message) };
        }
      }
      return obj;
    },
  },
});

export function getLogger(name: string) {
  return root.child({ module: name });
}
