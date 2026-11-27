# Multi-stage Docker build for the SekiroSlop Colyseus multiplayer server.
# Build from the repository root so workspace packages (`shared` + `server`) resolve cleanly:
#   docker build -f server/Dockerfile -t sekiroslop-server .

FROM node:22-alpine AS builder
WORKDIR /app

# Copy workspace manifests first for optimal Docker layer caching
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/

RUN npm ci --workspace=shared --workspace=server --include-workspace-root

# Copy source and build shared types/constants followed by the Colyseus server
COPY shared ./shared
COPY server ./server

RUN npm --workspace=shared run build && npm --workspace=server run build

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=2567

COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/

RUN npm ci --omit=dev --workspace=shared --workspace=server --include-workspace-root \
  && npm cache clean --force

COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/server/dist ./server/dist

EXPOSE 2567

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" || exit 1

USER node

CMD ["node", "server/dist/index.js"]
