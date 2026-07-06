FROM node:24-alpine AS base
WORKDIR /app

RUN apk add --no-cache openssl
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate

# Install dependencies
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Build
FROM deps AS build
COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
COPY scripts ./scripts
# Add client build
COPY client ./client
RUN pnpm install --frozen-lockfile
RUN cd client && pnpm build
RUN pnpm prisma generate
# Build API
RUN pnpm exec tsc --project tsconfig.json && node scripts/resolve-dist-aliases.mjs

# Production image
FROM node:24-alpine AS production
WORKDIR /app

RUN apk add --no-cache openssl
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY --from=build /app/dist ./dist
COPY --from=build /app/client/dist ./client/dist
COPY prisma ./prisma
RUN pnpm prisma generate

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://localhost:${PORT:-3000}/health" || exit 1

CMD ["sh", "-c", "pnpm prisma migrate deploy && node dist/server.js"]
