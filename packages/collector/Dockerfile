FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY packages/core/package*.json ./packages/core/
COPY packages/collector/package*.json ./packages/collector/

RUN npm install

COPY tsconfig.json ./
COPY packages/core ./packages/core
COPY packages/collector ./packages/collector

RUN npm run build --workspace=@doomwatch/core
RUN npm run build --workspace=@doomwatch/collector

FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/core/package.json ./packages/core/
COPY --from=builder /app/packages/collector/dist ./packages/collector/dist
COPY --from=builder /app/packages/collector/package.json ./packages/collector/

EXPOSE 4000

CMD ["node", "packages/collector/dist/index.js"]
