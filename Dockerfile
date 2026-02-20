FROM node:24-slim@sha256:bf22df20270b654c4e9da59d8d4a3516cce6ba2852e159b27288d645b7a7eedc AS base

WORKDIR /app

RUN corepack enable
COPY package.json pnpm-lock.yaml ./

FROM base AS nodemodules
RUN corepack prepare "$(node -p "require('./package.json').packageManager")" --activate && \
    pnpm install --frozen-lockfile --ignore-scripts

FROM base AS build

WORKDIR /app

COPY --from=nodemodules /app/node_modules /app/node_modules
COPY . ./

RUN pnpm exec nest build ftso-data-provider

FROM node:24-slim@sha256:bf22df20270b654c4e9da59d8d4a3516cce6ba2852e159b27288d645b7a7eedc AS runtime

WORKDIR /app

COPY --from=nodemodules /app/node_modules /app/node_modules
COPY --from=build /app/dist /app/dist

COPY . .

CMD ["node", "dist/apps/ftso-data-provider/src/main.js"]
