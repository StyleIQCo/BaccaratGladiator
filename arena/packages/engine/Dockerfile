# Engine image. Build context is the arena root (see docker-compose.yml).
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY packages ./packages
COPY web/package.json ./web/package.json
COPY config ./config
RUN npm install --no-audit --no-fund
CMD ["npx", "tsx", "packages/engine/src/index.ts"]
