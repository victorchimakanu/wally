# The app in DEMO mode as a static web export: fictional balances, simulated transfers,
# scripted chat, no wallet, no model, no backend. EXPO_PUBLIC_WALLY_API_URL is deliberately
# unset and .env files are ignored, so nothing in this image can reach a server.
#
# Served by nginx on 8082 with SPA fallback (every unknown path returns index.html).
# Build context is the repository root: docker compose -f docker-compose.product.yml build web-demo
FROM node:22-bookworm-slim AS build
WORKDIR /app/mobile
COPY mobile/package.json mobile/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY mobile/ ./
ENV EXPO_NO_DOTENV=1
RUN node --dns-result-order=ipv4first node_modules/expo/bin/cli export --platform web --output-dir dist/web

FROM nginx:1.27-alpine
COPY docker/nginx-spa.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/mobile/dist/web /usr/share/nginx/html
EXPOSE 8082
