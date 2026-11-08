import type { Chain } from './wallet-api.ts';

/**
 * What to tell someone standing on the Receive screen, derived from the addresses they have.
 *
 * This replaces a fixed sentence: *"Send only testnet ETH on <chain>. The same address works on
 * both test networks."* The second half was true only by accident. The loopback dev wallet
 * server derives one EOA and serves it for both chains, so the two addresses happen to match.
 *
 * They will not match for long. Arbitrum's account is an ERC-4337 Safe whose address comes from
 * the account factory rather than from the key, so the moment the on-device keystore runs, the
 * Arbitrum address and the Ethereum one are **different**. `CLAUDE.md` says so, the backend's
 * `/v1/history` takes `address.<chain>` for exactly that reason, and the Receive screen said the
 * opposite — on the one screen where someone decides where to send money.
 *
 * So the advice is read from the addresses themselves. Equal addresses say they are equal;
 * different ones say so and name the risk. A sentence derived from the data cannot outlive the
 * fact it describes.
 */

export type ReceiveAdvice = {
  /** The line under the address. Always present. */
  text: string;
  /** True when the other chain's address differs, so the screen can mark it. */
  chainSpecific: boolean;
};

export function receiveAdvice(
  chain: Chain,
  chainName: string,
  addresses: Partial<Record<Chain, string>>,
  nameOf: (chain: Chain) => string,
): ReceiveAdvice {
  const mine = addresses[chain];
  const others = (Object.keys(addresses) as Chain[])
    .filter(key => key !== chain && !!addresses[key]);

  // Nothing to compare against: say the one thing that is certainly true.
  if (!mine || others.length === 0) {
    return { text: `Send only testnet ETH on ${chainName}.`, chainSpecific: false };
  }

  const differing = others.filter(key => addresses[key]!.toLowerCase() !== mine.toLowerCase());

  if (differing.length === 0) {
    return {
      text: `Send only testnet ETH on ${chainName}. This same address also works on ${others.map(nameOf).join(' and ')}.`,
      chainSpecific: false,
    };
  }

  // The case that will become normal. Named plainly, because the failure is unrecoverable:
  // funds sent to an address on a chain that does not hold it are not coming back.
  return {
    text: `Send only testnet ETH on ${chainName}, and only to this address. Your ${differing.map(nameOf).join(' and ')} address is different — funds sent to the wrong one cannot be recovered.`,
    chainSpecific: true,
  };
}
