import path from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { config } from "../config.js";
import { getLogger } from "../logger.js";

const log = getLogger("wdk:server");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOOLKIT_BIN = path.resolve(
  __dirname,
  "..",
  "..",
  "node_modules",
  "@tetherto",
  "wdk-mcp-toolkit",
  "bin",
  "index.js"
);

const MAX_RESTARTS = 3;
const RESTART_DELAY_MS = 1000;

// WdkSubprocess manages the lifetime of the WDK MCP server child process.
// It exposes a single `client` that is reconnected automatically on crash.
export class WdkSubprocess extends EventEmitter {
  client: Client | null = null;

  private restarts = 0;
  private stopping = false;
  private transport: StdioClientTransport | null = null;

  async start(): Promise<void> {
    await this.connect();
    this.restarts = 0;
  }

  async stop(): Promise<void> {
    this.stopping = true;
    await this.transport?.close().catch(() => undefined);
    this.client = null;
    this.transport = null;
  }

  private buildEnv(): Record<string, string> {
    const env: Record<string, string> = {};

    // Copy through only non-sensitive env vars we need
    for (const k of [
      "PATH", "HOME", "NODE_PATH",
      "WDK_SEED", "WDK_SEED_COMMAND", "WDK_SEED_FILE",
      "WDK_INDEXER_API_KEY",
      "WDK_CONFIG",
    ]) {
      if (process.env[k]) env[k] = process.env[k]!;
    }

    // Set chain list and RPC overrides
    env["WDK_CHAINS"] = config.wdkChains.join(",");

    if (config.networkMode === "testnet") {
      env["WDK_RPC_ETHEREUM"] = process.env["WDK_RPC_ETHEREUM"] ?? "https://rpc.sepolia.org";
      env["WDK_RPC_ARBITRUM"] = process.env["WDK_RPC_ARBITRUM"] ?? "https://sepolia-rollup.arbitrum.io/rpc";
    } else {
      env["WDK_RPC_ETHEREUM"] = config.wdkRpcEthereum;
      env["WDK_RPC_ARBITRUM"] = config.wdkRpcArbitrum;
    }
    if (config.wdkIndexerApiKey) {
      env["WDK_INDEXER_API_KEY"] = config.wdkIndexerApiKey;
    }

    // Wally handles confirmation in the UI — disable MCP elicitation in the subprocess.
    env["WDK_MCP_ELICITATION"] = "false";

    return env;
  }

  private async connect(): Promise<void> {
    this.transport = new StdioClientTransport({
      command: process.execPath,
      args: [TOOLKIT_BIN, "serve"],
      env: this.buildEnv(),
    });

    const client = new Client({ name: "wally", version: "1.0.0" });

    // Reconnect on unexpected close
    this.transport.onclose = () => {
      if (this.stopping) return;
      log.warn("WDK MCP subprocess closed unexpectedly");
      this.scheduleRestart();
    };

    await client.connect(this.transport);
    this.client = client;
    log.info("WDK MCP subprocess connected");
    this.emit("ready");
  }

  private scheduleRestart(): void {
    if (this.restarts >= MAX_RESTARTS) {
      log.error({ restarts: this.restarts }, "WDK MCP subprocess failed too many times");
      this.emit("fatal");
      return;
    }
    this.restarts++;
    log.info({ attempt: this.restarts }, "Restarting WDK MCP subprocess...");
    setTimeout(() => {
      this.connect().catch((err) => {
        log.error({ err }, "Failed to restart WDK MCP subprocess");
        this.scheduleRestart();
      });
    }, RESTART_DELAY_MS);
  }
}

// Singleton instance used throughout the process.
export const wdkSubprocess = new WdkSubprocess();
