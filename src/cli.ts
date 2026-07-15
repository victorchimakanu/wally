// CLI test harness — run the full agent loop from the terminal.
// Use this to verify QVAC + WDK connectivity before starting the web server.
//
// Usage:
//   npm run cli
//
// Type a message and press Enter. Type 'quit' to exit.
// Confirmations are handled in the terminal (type 'yes' or 'no').

import { createInterface } from "node:readline";
import { wdkSubprocess } from "./wdk/server.js";
import { getDb } from "./db/index.js";
import { getOrCreateSession, handleInbound, bindWebSocket } from "./session/manager.js";
import { resolveConfirmation } from "./agent/confirm.js";
import { getLogger } from "./logger.js";
import type { WallyOutboundEvent } from "./types.js";

const log = getLogger("cli");

async function main() {
  console.log("Starting WDK MCP subprocess...");
  getDb();
  await wdkSubprocess.start();
  console.log("WDK ready.\n");

  const sessionId = getOrCreateSession();

  // Patch the session manager's emitter to print to stdout
  // (in the real server this goes over WebSocket)
  const fakeWs = {
    send: (data: string) => {
      const event: WallyOutboundEvent = JSON.parse(data);
      printEvent(event, sessionId);
    },
    readyState: 1,
  } as unknown as import("ws").WebSocket;
  bindWebSocket(sessionId, fakeWs);

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log("Wally CLI ready. Type a message, or 'quit' to exit.\n");

  const ask = () =>
    new Promise<string>((resolve) => rl.question("You: ", resolve));

  while (true) {
    const line = (await ask()).trim();
    if (!line || ["quit", "exit", "q"].includes(line.toLowerCase())) break;

    await handleInbound(sessionId, JSON.stringify({ type: "message", content: line }));
  }

  console.log("Shutting down...");
  await wdkSubprocess.stop();
  rl.close();
}

function printEvent(event: WallyOutboundEvent, sessionId: string) {
  switch (event.type) {
    case "message":
      console.log("\nWally:", event.content, "\n");
      break;
    case "typing":
      process.stdout.write("Wally is thinking...\n");
      break;
    case "error":
      console.error("\nWally error:", event.message, "\n");
      break;
    case "balance":
      console.log("\nBalances:");
      for (const b of event.balances) {
        console.log(`  ${b.chain}: ${b.amount} ${b.token}`);
      }
      console.log();
      break;
    case "confirmation": {
      const p = event.payload;
      console.log("\n--- CONFIRMATION REQUIRED ---");
      console.log(`  Action:    ${p.action}`);
      console.log(`  Amount:    ${p.amount} ${p.token_symbol}`);
      console.log(`  To:        ${p.recipient}`);
      console.log(`  Network:   ${p.chain}`);
      console.log(`  Fee:       ${p.fee}`);
      console.log("-----------------------------");
      const rl2 = createInterface({ input: process.stdin, output: process.stdout });
      rl2.question("Confirm? (yes/no): ", (answer) => {
        rl2.close();
        const confirmed = answer.trim().toLowerCase() === "yes";
        resolveConfirmation(sessionId, p.token, confirmed);
      });
      break;
    }
    case "tx_complete":
      console.log(`\nTransaction complete: ${event.txHash}`);
      if (event.explorerUrl) console.log(`  View: ${event.explorerUrl}`);
      console.log();
      break;
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
