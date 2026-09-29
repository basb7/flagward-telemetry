# Node 24 LTS (Node 20 reached end of life in April 2026; Vitest 5 needs >= 22).
FROM node:24-alpine AS base

ENV NEXT_TELEMETRY_DISABLED=1


# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci


# Build the app. No DATABASE_URL here: every database read happens at request
# time (see `connection()` in app/), so the build never needs one.
FROM base AS builder
WORKDIR /app

ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build


# Migrations and retention: plain Node scripts run with native type stripping,
# so they need production dependencies and the SQL migrations, not the build.
FROM base AS tools
WORKDIR /app

ENV NODE_ENV=production

# Only the two packages the scripts import; neither has dependencies of its
# own. package.json is needed for "type": "module".
COPY package.json ./
COPY --from=deps /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=deps /app/node_modules/postgres ./node_modules/postgres

COPY drizzle ./drizzle
COPY lib/retention.ts lib/retention.ts
COPY scripts/migrate.ts scripts/retention.ts scripts/

USER node

CMD ["node", "scripts/retention.ts"]


# Production image: standalone server output only, without node_modules,
# source files or build caches.
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

# Set the correct permission for prerender cache
RUN mkdir .next
RUN chown nextjs:nodejs .next

# Automatically leverage output traces to reduce image size
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://localhost:3000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
