# syntax=docker/dockerfile:1
# Build context: repository root (docker build -f apps/api/Dockerfile .)
FROM node:22.23.4-alpine3.24 AS build
WORKDIR /repo
RUN corepack enable
COPY . .
# --ignore-scripts: the only allowed install script is lefthook's git hook setup, not needed here.
RUN pnpm install --frozen-lockfile --ignore-scripts --filter "@cindermed/api..." \
 && pnpm --filter "@cindermed/api..." build \
 && pnpm --filter @cindermed/api deploy --prod --legacy /out

FROM node:22.23.4-alpine3.24
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "dist/server.js"]
