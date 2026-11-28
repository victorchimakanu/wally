/**
 * WDK worklet bundle configuration.
 *
 * This builds the Bare worklet that holds the wallet. Keys live inside that
 * worklet thread and in the phone's Keystore/Keychain — never in the React
 * Native JS thread, never in app storage, never on a server.
 *
 * CommonJS on purpose: this app is "type": "module", so a .js config is parsed as ESM and
 * `module.exports` throws. The bundler asks for .cjs. It was .js until 31 Oct 2026 and had
 * never been validated — `wdk-worklet-bundler validate` failed outright.
 *
 * Generate with:  npm run wdk:generate
 * Docs:           https://docs.wdk.tether.io/tools/worklet-bundler/
 *
 * Replaces the development wallet API server (scripts/wallet-api-server.mjs),
 * which keeps the seed on the developer's computer and is not a production path.
 * See docs/ADR-001-key-custody.md.
 */
module.exports = {
  // React Native uses the HRPC transport; the bundle is imported as a JS module.
  transport: 'hrpc',

  networks: {
    // Arbitrum is Wally's home chain. The ERC-4337 package gives a smart account
    // whose network fee is paid in USDt via a paymaster, so a user never holds ETH.
    arbitrum: { package: '@tetherto/wdk-wallet-evm-erc-4337' },

    // Ethereum runs the classic account path. Whether it also gets a bundler and
    // paymaster is still open — see F9 in the V1 spec.
    ethereum: { package: '@tetherto/wdk-wallet-evm' },
  },

  /**
   * Restrict what the worklet will execute.
   *
   * Without this, callMethod can invoke ANY method on the resolved account. Wally's design is
   * that code decides and the model never does; this is where that is enforced at the
   * boundary rather than in prompt text.
   *
   * VERIFIED 31 Oct 2026 against the installed packages' own READMEs, not guessed:
   *   getAddress            @tetherto/wdk-wallet-evm README line 117
   *   getBalance            line 144
   *   sendTransaction       line 188
   *   quoteSendTransaction  line 206 — the fee quote the send path needs BEFORE confirming
   *
   * quoteSendTransaction was missing from the first draft of this file, which was written
   * from a documented example and never validated. Without it the review screen cannot show
   * a fee, so the send path would fail at the one step that exists to stop someone approving
   * an amount they have not seen.
   *
   * Deliberately NOT allowed, each for a reason:
   *   signMessage / verifyMessage   the erc-4337 package signs arbitrary messages with the
   *                                 underlying EOA key. That is a phishing primitive, and
   *                                 nothing in Wally needs it.
   *   transfer / quoteTransfer / approve   ERC-20. Add these WITH the USDt work, not before.
   *                                 An allowlist permitting what the app cannot yet do is
   *                                 not a restriction.
   *   anything key-related          never.
   */
  allowedMethods: {
    arbitrum: { methods: ['getAddress', 'getBalance', 'sendTransaction', 'quoteSendTransaction'] },
    ethereum: { methods: ['getAddress', 'getBalance', 'sendTransaction', 'quoteSendTransaction'] },
  },

  output: {
    bundle: './.wdk-bundle/wdk-worklet.bundle.js',
    types: './.wdk/index.d.ts',
  },
};
