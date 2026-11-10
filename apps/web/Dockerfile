# syntax=docker/dockerfile:1
# Build context: repository root (docker build -f apps/web/Dockerfile .)
FROM node:22.23.4-alpine3.24 AS build
WORKDIR /repo
RUN corepack enable
COPY . .
# OIDC settings are fixed at build time (Vite); the defaults match Docker Compose.
ARG VITE_OIDC_AUTHORITY=http://localhost:8081/realms/cindermed
ARG VITE_OIDC_CLIENT_ID=cindermed-web
ENV VITE_OIDC_AUTHORITY=$VITE_OIDC_AUTHORITY VITE_OIDC_CLIENT_ID=$VITE_OIDC_CLIENT_ID
RUN pnpm install --frozen-lockfile --ignore-scripts --filter "@cindermed/web..." \
 && pnpm --filter @cindermed/web build

FROM nginxinc/nginx-unprivileged:1.31.7-alpine
COPY docker/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
