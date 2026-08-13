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
import { checkMessageRate, checkGlobalMessageRate } from "../middleware/rateLimit.js";
import { getLogger, scrubSecrets } from "../logger.js";
import { verifySessionCookie, isAllowedOrigin } from "../middleware/auth.js";
import { config } from "../config.js";

const log = getLogger("routes:ws");


export function attachWsServer(app: FastifyInstance): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  // Upgrade HTTP -> WebSocket
  app.server.on("upgrade", (req: IncomingMessage, socket, head) => {
    if (req.url !== "/ws") {
      socket.destroy();
      return;
    }
    // A browser page must be same-origin; any client must present the signed
    // HttpOnly cookie issued by GET /. Unauthenticated sockets never reach
    // the wallet. This runs in a raw upgrade listener with no framework
    // error boundary, so any throw is contained here — a crafted request must
    // never be able to crash the process.
    let authed = false;
    try {
      authed = isAllowedOrigin(req.headers["origin"]) && verifySessionCookie(req.headers["cookie"]) !== null;
    } catch {
      authed = false;
    }
    if (!authed) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const verifiedId = verifySessionCookie(req.headers["cookie"]);
    if (!verifiedId) {
      ws.close(1008, "unauthorized");
      return;
    }
    const sessionId = getOrCreateSession(verifiedId);

    bindWebSocket(sessionId, ws);
    log.info({ session_id: sessionId }, "WebSocket connected");

    // The session identity lives only in the signed HttpOnly cookie.
    ws.send(JSON.stringify({ type: "connected", networkMode: config.networkMode }));

    // Replay stored conversation so a resumed session shows its history.
    // Scrub on the way out: persisted content is raw (an earlier error turn
    // could have stored a secret), so it must pass the same scrubber the live
    // send path applies.
    const past = loadHistory(sessionId).map((m) => ({ ...m, content: scrubSecrets(m.content) }));
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

      // Per-session limit, plus a global ceiling so minting fresh sessions
      // cannot bypass it and exhaust on-device model compute.
      if (needsRateLimit && (!checkMessageRate(sessionId) || !checkGlobalMessageRate())) {
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
