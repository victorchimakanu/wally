FROM node:22-slim AS base
WORKDIR /app

# Install git (required to install wdk-mcp-toolkit from GitHub)
RUN apt-get update && apt-get install -y git python3 make g++ && rm -rf /var/lib/apt/lists/*

# ─── deps ────────────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts && npm rebuild better-sqlite3

# ─── build ───────────────────────────────────────────────────────────────────
FROM deps AS build
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc --project tsconfig.json

# ─── runtime ─────────────────────────────────────────────────────────────────
FROM node:22-slim AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y git python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts && npm rebuild better-sqlite3

COPY --from=build /app/dist ./dist
COPY public/ ./public/
COPY src/db/schema.sql ./dist/db/schema.sql

EXPOSE 3000

# Seed must be supplied via WDK_SEED_COMMAND or WDK_SEED_FILE at runtime.
# Never bake credentials into the image.
ENV NODE_ENV=production \
    LOG_LEVEL=info \
    PORT=3000

CMD ["node", "dist/server.js"]
