# Self-hosted trade journal — single container, SQLite on a volume.
FROM node:22-slim AS builder
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages ./packages
COPY apps/web/package.json ./apps/web/package.json
RUN pnpm install --frozen-lockfile
COPY apps/web ./apps/web
COPY tsconfig.base.json ./
RUN pnpm --filter web build

FROM node:22-slim AS runner
ENV NODE_ENV=production
ENV JOURNAL_DATA_DIR=/data
WORKDIR /app
# Next standalone output bundles the server and pruned node_modules.
COPY --from=builder /repo/apps/web/.next/standalone ./
COPY --from=builder /repo/apps/web/.next/static ./apps/web/.next/static
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME /data
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "apps/web/server.js"]
