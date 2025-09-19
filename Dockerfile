FROM node:22-slim@sha256:4a4884e8a44826194dff92ba316264f392056cbe243dcc9fd3551e71cea02b90 AS nodemodules

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --network-timeout 100000

FROM node:22-slim@sha256:4a4884e8a44826194dff92ba316264f392056cbe243dcc9fd3551e71cea02b90 AS build

WORKDIR /app

COPY --from=nodemodules /app/node_modules /app/node_modules
COPY . ./

RUN yarn build
RUN yarn build ftso-reward-calculation-process

FROM node:22-slim@sha256:4a4884e8a44826194dff92ba316264f392056cbe243dcc9fd3551e71cea02b90 AS runtime

WORKDIR /app

COPY --from=nodemodules /app/node_modules /app/node_modules
COPY --from=build /app/dist /app/dist

COPY . .

CMD ["bash"]

