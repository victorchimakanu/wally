import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/integration/**"],
    environment: "node",
    env: {
      // Minimum required config so the config module does not exit during tests.
      SESSION_SECRET: "test-secret-for-vitest-only-not-production",
      QVAC_MODEL_ID: "qwen3-4b-instruct",
      WDK_CHAINS: "ethereum,arbitrum,bitcoin",
      LOG_LEVEL: "error",
    },
    // Resolve .js extension imports to their .ts source files.
    // Required because tsconfig uses NodeNext which mandates explicit .js extensions,
    // but vitest (via Vite) compiles TypeScript directly and resolves .ts files.
    alias: [{ find: /^(\.\.?\/.*?)\.js$/, replacement: "$1" }],
  },
});
