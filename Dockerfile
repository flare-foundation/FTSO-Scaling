FROM node:18-slim as nodemodules

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile


FROM node:18-slim as build

WORKDIR /app

COPY --from=nodemodules /app/node_modules /app/node_modules
COPY . ./

RUN yarn build


FROM node:18-slim as runtime

WORKDIR /app

COPY --from=build /app/dist /app/dist
COPY --from=nodemodules /app/node_modules /app/node_modules

COPY . .

CMD ["bash"]

