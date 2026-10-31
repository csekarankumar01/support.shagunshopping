# syntax=docker/dockerfile:1
# Next.js app, built as a self-contained "standalone" server.
FROM node:25-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:25-slim AS build
WORKDIR /app
# Baked into the browser code at build time: where the BROWSER reaches the API's WebSocket.
ARG NEXT_PUBLIC_SOCKET_URL=http://localhost:4310
ENV NEXT_PUBLIC_SOCKET_URL=$NEXT_PUBLIC_SOCKET_URL \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:25-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=4311 \
    HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
USER node
EXPOSE 4311
CMD ["node", "server.js"]
