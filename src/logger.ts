import pino from "pino";
import { config } from "./config.js";

const root = pino({
  level: config.logLevel,
  redact: {
    paths: [
      "seed", "*.seed", "WDK_SEED", "*.WDK_SEED",
      "privateKey", "*.privateKey", "keyPair", "*.keyPair",
    ],
    censor: "[REDACTED]",
  },
});

export function getLogger(name: string) {
  return root.child({ module: name });
}
