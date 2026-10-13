# syntax=docker/dockerfile:1
# OpenLeaf: one container running the API, realtime server, git bridge and the
# built web app. Compiles run in sibling TeX Live containers via the host's
# Docker daemon (see docker-compose.yml).

FROM node:22-bookworm-slim AS build
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /src
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build
RUN pnpm --filter @openleaf/server deploy --prod --legacy /out

FROM node:22-bookworm-slim
# pandoc: Word/Markdown/HTML exports (bookworm ships 2.17; the server adapts its flags).
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates pandoc util-linux \
  && rm -rf /var/lib/apt/lists/*
COPY --from=docker:28-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=build /out /app
COPY --from=build /src/apps/web/dist /app/web
RUN mkdir -p /var/lib/openleaf && chown node:node /var/lib/openleaf
ENV NODE_ENV=production \
  OPENLEAF_HOST=0.0.0.0 \
  OPENLEAF_WEB_DIST=/app/web \
  OPENLEAF_COMPILE_RUNNER=docker \
  OPENLEAF_DATA_DIR=/var/lib/openleaf
USER node
WORKDIR /app
EXPOSE 3000
CMD ["node", "/app/dist/index.js"]
