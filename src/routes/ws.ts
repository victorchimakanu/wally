import type { FastifyInstance } from "fastify";
import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import {
  getOrCreateSession,
  bindWebSocket,
  unbindWebSocket,
  handleInbound,
} from "../session/manager.js";
import { loadHistory } from "../session/store.js";
import { checkMessageRate } from "../middleware/rateLimit.js";
import { getLogger } from "../logger.js";
import { config } from "../config.js";

const log = getLogger("routes:ws");

// Cookie helper — parse a "name=value" pair from Cookie header
function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k?.trim() === name && v) return decodeURIComponent(v.trim());
  }
  return undefined;
}

export function attachWsServer(app: FastifyInstance): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  // Upgrade HTTP -> WebSocket
  app.server.on("upgrade", (req: IncomingMessage, socket, head) => {
    if (req.url !== "/ws") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const cookieHeader = req.headers["cookie"];
    const existingId = parseCookie(cookieHeader, "wally_session");
    const sessionId = getOrCreateSession(existingId);

    bindWebSocket(sessionId, ws);
    log.info({ session_id: sessionId }, "WebSocket connected");

    // Tell the client which session ID to echo back as a cookie
    ws.send(
      JSON.stringify({ type: "connected", sessionId, networkMode: config.networkMode })
    );

    // Replay stored conversation so a resumed session shows its history
    const past = loadHistory(sessionId);
    if (past.length > 0) {
      ws.send(JSON.stringify({ type: "history", messages: past }));
    }

    ws.on("message", async (data) => {
      const raw = data.toString();

      // Only rate-limit user chat messages that go through QVAC.
      // Balance, address, and confirmation events are UI actions, not AI calls.
      let eventType: string | undefined;
      try { eventType = (JSON.parse(raw) as { type?: string }).type; } catch { /* ignore */ }
      const needsRateLimit = eventType === "message";

      if (needsRateLimit && !checkMessageRate(sessionId)) {
        ws.send(JSON.stringify({ type: "error", message: "Rate limit exceeded. Please wait a moment." }));
        return;
      }

      await handleInbound(sessionId, raw);
    });

    ws.on("close", () => {
      unbindWebSocket(sessionId);
      log.info({ session_id: sessionId }, "WebSocket closed");
    });

    ws.on("error", (err) => {
      log.error({ session_id: sessionId, err }, "WebSocket error");
    });
  });

  return wss;
}
