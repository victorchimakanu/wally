import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { getLogger } from "../logger.js";

const log = getLogger("status");

/**
 * The remote stop button.
 *
 * Everything else in this repository assumes mistakes can be fixed. This is the one endpoint
 * that assumes they cannot: if a build ships that loses money, there is otherwise no way to
 * stop it. A store release takes days of review, there are no over-the-air updates, and every
 * installed copy keeps running the broken version in the meantime. One flag here is the
 * difference between an apology and a loss.
 *
 * **It fails open, deliberately.** An app that cannot reach this endpoint keeps working.
 * Sending does not require this service — the phone signs and the chain accepts — so a backend
 * outage must not take the wallet down with it. The threat this defends against is *our* bug,
 * not an adversarial user, and an adversary who can block a network request can also just use
 * an older build. Failing closed would trade a real outage for protection that does not hold.
 *
 * Nothing here is authenticated beyond the usual app key, and nothing here is secret: it says
 * only whether we currently believe sending is safe.
 */
export async function statusRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/status", async (_request, reply) => {
    const disabled = config.sendingDisabledReason.trim();

    // Not cached — but that comes from the server-wide onRequest hook, which sets
    // Cache-Control: no-store on every response. Repeating it here looked like belt and
    // braces until a mutation proved the local line could be deleted with no effect, so it is
    // gone. The guarantee lives in server.ts; the test below asserts the header regardless of
    // which layer produces it.

    if (disabled) log.warn({ reason: disabled }, "serving status with sending disabled");

    return reply.send({
      version: 1,
      /** False only when an operator has set a reason. Absence of a reason means go. */
      sendingEnabled: disabled.length === 0,
      /**
       * Shown to the user verbatim when sending is off, so it has to read like something a
       * person wrote. Empty when sending is enabled.
       */
      reason: disabled,
      /**
       * Builds below this must refuse to send and tell the user to update. Empty disables the
       * check, which is the default: a version gate that nobody maintains is a way to brick
       * working installs.
       */
      minimumVersion: config.minimumAppVersion,
      checkedAt: Date.now(),
    });
  });
}
