# Stage 1: build
FROM node:24-bookworm-slim AS build

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

USER node
WORKDIR /app

COPY --chown=node:node . .

RUN corepack enable yarn && \
    yarn install --immutable && \
    yarn tsc && \
    yarn build:backend

# Stage 2: production
FROM node:24-bookworm-slim AS production

RUN apt-get update && apt-get install -y --no-install-recommends \
    libsqlite3-dev \
    python3 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

USER node
WORKDIR /app

COPY --chown=node:node --from=build /app/yarn.lock /app/package.json ./
COPY --chown=node:node --from=build /app/packages/backend/dist ./packages/backend/dist
COPY --chown=node:node --from=build /app/packages/backend/package.json ./packages/backend/package.json
COPY --chown=node:node app-config.yaml app-config.production.yaml ./

RUN corepack enable yarn && \
    yarn workspaces focus --all --production && \
    yarn cache clean

EXPOSE 7007

CMD ["node", "packages/backend", "--config", "app-config.yaml", "--config", "app-config.production.yaml"]
