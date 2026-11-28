import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    /**
     * config.ts loads .env.local at import, and only for keys not already in process.env.
     * Setting them here makes the suite independent of whatever a developer has configured
     * locally — without this, switching INDEXER_PROVIDER for a manual test silently breaks
     * the history cases, which is exactly what happened on 21 Oct 2026.
     */
    env: {
      INDEXER_PROVIDER: "etherscan",
      /**
       * Empty, which is the production default. A developer's .env.local lists the web
       * preview's origins, and the CORS preflight case was passing because of that file
       * rather than because of the code — it asserted 204 and got 403 the moment it ran on
       * a clean checkout. A test that needs an allowlist now stubs its own.
       */
      ALLOWED_ORIGINS: "",
    },
    // Resolve the .js extensions NodeNext requires back to their .ts sources.
    alias: [{ find: /^(\.\.?\/.*?)\.js$/, replacement: "$1" }],
  },
});
