# DEVELOPMENT ONLY. The loopback dev wallet server from mobile/scripts/wallet-api-server.mjs:
# one testnet wallet whose seed sits in a bind mount at internal/testnet-wallet (gitignored).
# It is single-user by construction and must never become a hosted service
# (docs/ADR-001-key-custody.md). The image holds the pinned WDK runtime and the two scripts,
# nothing else; no seed is ever baked in.
#
# Build context is the repository root: docker compose -f docker-compose.product.yml build wallet-server
FROM node:22-bookworm-slim
WORKDIR /app
# Same pinned, isolated runtime that `npm run wallet:install` puts under internal/ on a laptop.
RUN npm install --prefix internal/wallet-api-runtime --save-exact \
      @tetherto/wdk-wallet-evm@1.0.0-beta.14 qrcode@1.5.4 --no-audit --no-fund
COPY mobile/scripts/wallet-api-core.mjs mobile/scripts/wallet-api-server.mjs mobile/scripts/
EXPOSE 3003
CMD ["node", "mobile/scripts/wallet-api-server.mjs"]
