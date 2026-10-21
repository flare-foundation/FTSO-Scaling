#checkov:skip=CKV_DOCKER_2: Health check is handled by deployment orchestrator
FROM node:24.22.1-slim@sha256:1681862882da07ee5476fee047bcf34138833f1df42633bb25bcb0f438d5bf3d AS base

WORKDIR /app

RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

FROM base AS nodemodules
RUN corepack prepare "$(node -p "require('./package.json').packageManager")" --activate && \
    pnpm install --frozen-lockfile --ignore-scripts

FROM base AS build

WORKDIR /app

COPY --from=nodemodules /app/node_modules /app/node_modules
COPY . ./

RUN pnpm exec nest build ftso-data-provider

FROM node:24.22.1-slim@sha256:1681862882da07ee5476fee047bcf34138833f1df42633bb25bcb0f438d5bf3d AS runtime

WORKDIR /app

RUN groupadd -g 10001 app && useradd -u 10001 -g app -s /sbin/nologin app

COPY --from=nodemodules /app/node_modules /app/node_modules
COPY --from=build /app/dist /app/dist

COPY . .

RUN chown -R 10001:10001 /app

USER 10001:10001

CMD ["node", "dist/apps/ftso-data-provider/src/main.js"]
