# syntax=docker/dockerfile:1

# --- build stage: install all deps and build the web SPA ---
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build:web

# --- runtime stage ---
FROM node:24-slim AS runtime
ENV NODE_ENV=production
# git is required by the engine (simple-git).
RUN apt-get update \
  && apt-get install -y --no-install-recommends git \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# node_modules carries tsx (now a runtime dependency) — the agent spawns the
# MCP child from .ts files, so we run sources directly, no JS compile step.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/web/dist ./web/dist
COPY --from=build /app/src ./src
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/tsconfig.json ./tsconfig.json
# COMMONS_ROOT (/data) is a named volume. Create it owned by `node` so a fresh
# volume inherits node ownership — otherwise it defaults to root:root and the
# non-root runtime can't create commons.db (SQLITE_CANTOPEN).
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "start"]
