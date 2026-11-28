import pino from "pino";
import { config } from "./config.js";

/**
 * Redact anything that could carry a provider key. This service holds no wallet secrets,
 * but upstream URLs can embed API keys in query strings and must never reach a log line.
 */
const KEY_PATTERN = /([?&](?:api[_-]?key|apikey|key|token|x-cg-[a-z-]*api-key)=)[^&\s"']+/gi;

export function scrubSecrets(value: string): string {
  return value.replace(KEY_PATTERN, "$1[redacted]");
}

const root = pino({
  level: config.logLevel,
  // null, not undefined: pino types reject undefined under exactOptionalPropertyTypes.
  base: null,
  formatters: { level: (label) => ({ level: label }) },
  hooks: {
    logMethod(args, method) {
      const scrubbed = args.map((arg) => (typeof arg === "string" ? scrubSecrets(arg) : arg));
      method.apply(this, scrubbed as Parameters<typeof method>);
    },
  },
});

export function getLogger(scope: string) {
  return root.child({ scope });
}
