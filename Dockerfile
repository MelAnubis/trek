# Stage 1: Build React client
FROM node:24-alpine AS client-builder
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install --legacy-peer-deps
COPY client/ ./
RUN npm run build

# Stage 2: Production server
FROM node:24-alpine

WORKDIR /app

# Timezone support + native deps (better-sqlite3 needs build tools)
COPY server/package*.json ./
RUN apk add --no-cache tzdata dumb-init su-exec python3 make g++ libheif libheif-dev && \
    npm ci --production && \
    npm rebuild sharp && \
    rm package-lock.json && \
    apk del python3 make g++ && \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

COPY server/ ./
COPY --from=client-builder /app/client/dist ./public
COPY --from=client-builder /app/client/public/fonts ./public/fonts

RUN rm -f package-lock.json && \
    mkdir -p /app/data/logs /app/uploads/files /app/uploads/covers /app/uploads/avatars /app/uploads/photos /app/uploads/nav-photos && \
    mkdir -p /app/server && ln -s /app/uploads /app/server/uploads && ln -s /app/data /app/server/data && \
    chown -R node:node /app

# KDE KItinerary extractor — enables booking-confirmation import.
# Install best-effort; if unavailable the feature is simply disabled at runtime
# (the /api/health/features endpoint returns { bookingImport: false }).
# On Alpine the package lives in the community repo; ignore failures gracefully.
RUN apk add --no-cache --repository=https://dl-cdn.alpinelinux.org/alpine/edge/community kitinerary 2>/dev/null || true

ENV NODE_ENV=production
ENV PORT=3000
# Left empty by default — only the release workflow passes a real value via
# --build-arg. A self-hosted build (e.g. `docker compose up -d --build`,
# building straight from the checkout with no build-arg) previously baked in
# the literal string "dev" here, which then WON the server's own version
# fallback (`process.env.APP_VERSION ?? package.json version`) over the
# accurate version already committed in package.json — showing "vdev" in
# the app instead of the real release number. Left empty, the server's
# fallback reads the real version straight out of package.json instead.
ARG APP_VERSION=
ENV APP_VERSION=${APP_VERSION}

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "-c", "chown -R node:node /app/data /app/uploads 2>/dev/null || true; exec su-exec node node --import tsx src/index.ts"]
