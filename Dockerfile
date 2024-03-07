FROM node:18

RUN apt-get clean && apt-get update && \
    apt-get install -y --no-install-recommends \
    netcat-traditional

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

COPY . ./

RUN yarn build

CMD ["bash"]

