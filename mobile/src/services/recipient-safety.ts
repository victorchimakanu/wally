/**
 * Refusing to send to a contract, which is an unrecoverable burn.
 *
 * ## The hole this fills
 *
 * The reference app has refused this since **19 August 2026** — `isKnownContractAddress()` in
 * `src/wdk/lending.ts`, called from the agent before any transfer, because tokens sent to a
 * token contract or an Aave pool are gone. The mobile app shipped without it. Until now the
 * only check on the whole phone path was `eth_getCode` inside the **dev wallet server**
 * (`wallet-api-core.mjs`, at quote and again before signing).
 *
 * That is a real guard today and it is also the wrong place for the only copy of it, for one
 * reason: **the dev wallet server is development-only and goes away.** When signing moves into
 * the on-device worklet there is no server in the path, and with it the single thing standing
 * between a pasted contract address and a burn disappears — silently, as a side effect of
 * shipping the thing the whole roadmap is aimed at. A guard that exists only in the component
 * being removed is not a guard, it is a countdown.
 *
 * ## Two checks, because they fail differently
 *
 * **The pinned-token check is local and always runs.** No network, no backend, no latency. It
 * catches the case that actually happens to people: pasting the USDt *contract* address because
 * that is what a block explorer shows when you search for USDt, and sending USDt to it. The
 * address list is the same `tokens.ts` the Send screen builds its asset picker from, so a token
 * pinned tomorrow is refused tomorrow with nothing else edited.
 *
 * **The `eth_getCode` check is broader and needs the network.** Any contract, not just ones we
 * know. It goes through the backend proxy, where `eth_getCode` is on the method allowlist
 * (`backend/src/config.ts:87`).
 *
 * ## Why an unreachable node does not block the send
 *
 * `recipientKind()` returns `unknown` rather than guessing when it cannot ask — no backend
 * configured, a node that will not answer, a malformed reply. `unknown` does **not** refuse.
 *
 * That is the right call *today* and it is worth writing down why, because it changes:
 * the dev wallet server still performs the same check unconditionally before it signs, so a
 * contract recipient is caught either way, and failing closed here would mean an offline phone
 * cannot send at all. The moment signing moves on-device, that second check is gone and
 * `unknown` has to become a refusal — see `docs/agent-transfer-guards.md`. The local
 * pinned-token half keeps working in both worlds, which is why it is separate.
 */
import { backendHeaders, backendOrigin } from './backend.ts';
import { displaySymbol, tokenAt } from './tokens.ts';
import type { Chain } from './wallet-api.ts';

/** What the chain says about an address, or that it could not be asked. */
export type RecipientKind = 'wallet' | 'contract' | 'unknown';

/**
 * A pinned token contract at this address, or null. No network call.
 *
 * `tokenAt` already does this lookup case-insensitively and returns null for anything not
 * pinned — deliberately, because inventing a token from an unknown address is how an amount
 * gets the wrong number of decimals.
 */
export function pinnedTokenContract(chain: Chain, address: string): { symbol: string } | null {
  const token = tokenAt(chain, address);
  return token ? { symbol: displaySymbol(token.symbol) } : null;
}

/**
 * Ask the chain whether an address holds code.
 *
 * `eth_getCode` answers `0x` for an ordinary wallet and bytecode for a contract. Anything that
 * is not one of those two shapes is `unknown`: a node that returns something unexpected must
 * not be read as "ordinary wallet", which is the answer that lets money move.
 */
export async function recipientKind(
  chain: Chain,
  address: string,
  transport: typeof fetch = fetch,
): Promise<RecipientKind> {
  const origin = backendOrigin();
  if (!origin) return 'unknown';
  try {
    const response = await transport(`${origin}/v1/rpc/${chain}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...backendHeaders(origin) },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getCode', params: [address, 'latest'] }),
    });
    if (!response.ok) return 'unknown';
    const body = await response.json() as { result?: unknown };
    if (typeof body?.result !== 'string' || !/^0x([\da-f]{2})*$/i.test(body.result)) return 'unknown';
    return body.result === '0x' ? 'wallet' : 'contract';
  } catch { return 'unknown'; }
}

/** Sending a token to its own contract is the burn people actually perform. */
export function pinnedTokenRefusal(symbol: string): string {
  return `That address is the ${symbol} contract itself, not a wallet. Anything sent there is destroyed and cannot be recovered. Check where you copied it from. Nothing was sent.`;
}

/** Any other contract. Worded like the wallet server's, which refuses the same thing. */
export const CONTRACT_REFUSAL =
  'That address is a contract, not an ordinary wallet. Wally does not send to contracts, because '
  + 'funds sent to one are usually unrecoverable. Nothing was sent.';

/**
 * The reason this recipient must not be paid, or null when there is none.
 *
 * The local check runs first and without the network, so the commonest burn is refused even
 * with nothing configured and nothing reachable.
 */
export async function contractRecipientRefusal(
  chain: Chain,
  address: string,
  transport: typeof fetch = fetch,
): Promise<string | null> {
  const pinned = pinnedTokenContract(chain, address);
  if (pinned) return pinnedTokenRefusal(pinned.symbol);
  return (await recipientKind(chain, address, transport)) === 'contract' ? CONTRACT_REFUSAL : null;
}
