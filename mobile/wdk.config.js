/**
 * WDK worklet bundle configuration.
 *
 * This builds the Bare worklet that holds the wallet. Keys live inside that
 * worklet thread and in the phone's Keystore/Keychain — never in the React
 * Native JS thread, never in app storage, never on a server.
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
   * Without this, callMethod can invoke ANY method on the resolved account,
   * including fund-moving and key-export operations. Wally's whole design is that
   * code decides and the model never does; this is where that is enforced at the
   * boundary rather than in prompt text.
   *
   * V1 needs reads, a fee quote and a send. Nothing else.
   *
   * UNVERIFIED: these method names follow the bundler's documented example. Check
   * them against the installed wallet package's surface after `npm run wdk:install`
   * and correct before relying on the restriction.
   */
  allowedMethods: {
    arbitrum: { methods: ['getAddress', 'getBalance', 'sendTransaction'] },
    ethereum: { methods: ['getAddress', 'getBalance', 'sendTransaction'] },
  },

  output: {
    bundle: './.wdk-bundle/wdk-worklet.bundle.js',
    types: './.wdk/index.d.ts',
  },
};
