# The Wally backend proxy. Holds no keys, no seeds, no personal data; it forwards and refuses.
# See README.md. Run it through ../docker-compose.product.yml, which binds it to loopback and
# publishes the port from a sidecar so the loopback-only development routes stay available.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]
