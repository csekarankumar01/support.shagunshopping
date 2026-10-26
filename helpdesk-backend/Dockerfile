# syntax=docker/dockerfile:1
# NestJS API. Needs Node 24 (the Kafka client requires >= 22.22 or >= 24.6).
FROM node:24-slim AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# Migrations run from this same image (the "migrate" service in docker-compose.yml).
COPY db ./db
USER node
EXPOSE 4310
CMD ["node", "dist/main.js"]
