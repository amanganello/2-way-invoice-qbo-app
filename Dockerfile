FROM node:24-alpine AS base
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

# Install dependencies
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Build
FROM deps AS build
COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
# Add client build
COPY client/package.json client/pnpm-lock.yaml ./client/
RUN cd client && pnpm install --frozen-lockfile
COPY client ./client
RUN cd client && pnpm build
# Build API
RUN pnpm exec tsc --project tsconfig.json
RUN pnpm prisma generate

# Production image
FROM node:24-alpine AS production
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY --from=build /app/dist ./dist
COPY --from=build /app/client/dist ./client/dist
COPY --from=build /app/node_modules/.pnpm/@prisma+client*/node_modules/@prisma/client/runtime ./node_modules/@prisma/client/runtime
COPY prisma ./prisma
RUN pnpm prisma generate

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/server.js"]
