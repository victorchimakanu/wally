// Integration smoke test. Starts the Wally server, connects over WebSocket,
// sends a balance query, and expects a balance response or error.
//
// Requires: QVAC running locally and WDK_SEED set in .env.local.
// Skip in CI unless those conditions are set up.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";

const PORT = process.env["TEST_PORT"] ?? "3001";
const WS_URL = `ws://localhost:${PORT}/ws`;

const skip = !process.env["INTEGRATION"];
const itOrSkip = skip ? it.skip : it;

describe("integration: WebSocket chat", () => {
  itOrSkip("receives a connected event on first connect", async () => {
    const ws = new WebSocket(WS_URL);
    const event = await waitForEvent(ws, "connected");
    expect(event.type).toBe("connected");
    expect(typeof event.sessionId).toBe("string");
    ws.close();
  }, 10_000);

  itOrSkip("rate limits after 10 messages per minute", async () => {
    const ws = new WebSocket(WS_URL);
    await waitForEvent(ws, "connected");

    const sends = Array.from({ length: 11 }, () =>
      new Promise<void>((resolve) => {
        ws.send(JSON.stringify({ type: "message", content: "test" }));
        setTimeout(resolve, 50);
      })
    );
    await Promise.all(sends);

    const err = await waitForEvent(ws, "error", 3000);
    expect(err.message).toMatch(/rate limit/i);
    ws.close();
  }, 15_000);
});

function waitForEvent(ws: WebSocket, type: string, timeout = 8000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for event type: ${type}`)), timeout);

    ws.on("message", (data) => {
      let event: Record<string, unknown>;
      try { event = JSON.parse(data.toString()) as Record<string, unknown>; } catch { return; }
      if (event["type"] === type) {
        clearTimeout(timer);
        resolve(event);
      }
    });

    ws.on("error", (err) => { clearTimeout(timer); reject(err); });
  });
}
