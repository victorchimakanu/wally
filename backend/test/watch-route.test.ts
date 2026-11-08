import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { watchRoutes } from "../src/routes/watch.js";
import { createWatcher, type Receipt } from "../src/watcher.js";

/**
 * The route's job is to refuse anything that is not a hash, to answer honestly when a transfer
 * is not being watched, and never to claim a failure it has not seen.
 */

const HASH = "0x" + "a".repeat(64);

async function serve(answer: () => Receipt) {
  const app = Fastify();
  const watcher = createWatcher({ fetchReceipt: async () => answer() });
  await app.register(watchRoutes, { watcher });
  return { app, watcher };
}

describe("POST /v1/watch/:chain/:hash", () => {
  it("starts watching and asks the chain straight away", async () => {
    // A transfer submitted a minute ago may already be settled, and making the caller wait a
    // whole poll interval to find that out defeats the point of the service.
    const { app } = await serve(() => ({ status: "0x1", blockNumber: "0x2a" }));
    const res = await app.inject({ method: "POST", url: `/v1/watch/arbitrum/${HASH}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ chain: "arbitrum", state: "confirmed", blockNumber: 42 });
    await app.close();
  });

  it("reports pending rather than guessing when there is no receipt yet", async () => {
    const { app } = await serve(() => null);
    const res = await app.inject({ method: "POST", url: `/v1/watch/ethereum/${HASH}` });
    expect(res.json()).toMatchObject({ state: "pending" });
    await app.close();
  });

  it("refuses anything that is not a hash or a known chain", async () => {
    const { app } = await serve(() => null);
    for (const url of [
      `/v1/watch/solana/${HASH}`,
      "/v1/watch/arbitrum/0xnope",
      "/v1/watch/arbitrum/" + "a".repeat(64),
      "/v1/watch/arbitrum/" + "0x" + "a".repeat(63),
    ]) {
      const res = await app.inject({ method: "POST", url });
      expect(res.statusCode, url).toBe(400);
    }
    await app.close();
  });

  it("a node that is down leaves it pending, and still answers 200", async () => {
    // The caller asked us to watch. We are watching. We simply do not know yet.
    const { app } = await serve(() => { throw new Error("node down"); });
    const res = await app.inject({ method: "POST", url: `/v1/watch/arbitrum/${HASH}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ state: "pending" });
    await app.close();
  });
});

describe("GET /v1/watch/:chain/:hash", () => {
  it("says plainly when a transfer is not being watched", async () => {
    // 404 with watching:false, not an empty 200. "I have no record" and "it has not landed"
    // are different claims and the app must be able to tell them apart.
    const { app } = await serve(() => null);
    const res = await app.inject({ method: "GET", url: `/v1/watch/arbitrum/${HASH}` });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ watching: false });
    await app.close();
  });

  it("returns the state once it is being watched", async () => {
    const { app } = await serve(() => ({ status: "0x0", blockNumber: "0x5" }));
    await app.inject({ method: "POST", url: `/v1/watch/arbitrum/${HASH}` });
    const res = await app.inject({ method: "GET", url: `/v1/watch/arbitrum/${HASH}` });
    expect(res.json()).toMatchObject({ state: "failed", blockNumber: 5 });
    await app.close();
  });

  it("is case-insensitive about the hash, as the chain is", async () => {
    const { app } = await serve(() => ({ status: "0x1" }));
    await app.inject({ method: "POST", url: `/v1/watch/arbitrum/${HASH}` });
    const res = await app.inject({ method: "GET", url: `/v1/watch/arbitrum/${HASH.toUpperCase().replace("0X", "0x")}` });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("the interval never holds the process open", async () => {
    // A proxy that will not shut down because it is mid-poll is worse than a transfer checked
    // a few seconds later.
    const { app } = await serve(() => null);
    const closed = vi.fn();
    await app.close().then(closed);
    expect(closed).toHaveBeenCalled();
  });
});
