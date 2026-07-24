# Build context: repository root
FROM node:20-bookworm-slim AS build
WORKDIR /app/coordinator
COPY coordinator/package.json coordinator/package-lock.json ./
RUN npm ci
COPY coordinator/tsconfig.json ./
COPY coordinator/src ./src
RUN npm run build

FROM node:20-bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app/coordinator
ENV NODE_ENV=production
COPY coordinator/package.json coordinator/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/coordinator/dist ./dist
COPY frontend /app/frontend
EXPOSE 1337
CMD ["node", "dist/server.js"]
