# syntax=docker/dockerfile:1
#
# The Next.js demo workspace. Build from the repository root because its build
# step reads backend/artifacts and the project documentation:
#
#   docker compose --profile demo up --build     # api + frontend, http://localhost:3001
#   docker build -f frontend/Dockerfile -t ethiofoodcast-web .
#   docker run --rm -p 127.0.0.1:3001:3001 -e API_INTERNAL_URL=http://host.docker.internal:5000 ethiofoodcast-web
#
# Three stages, and the split is the point: `next build` needs node_modules
# (~400 MB) plus the artifacts, while the runtime needs neither. Only the
# standalone server, its static assets and its pruned node_modules are copied
# forward.

FROM node:22-bookworm-slim AS deps

ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app/frontend

# package-lock.json is gitignored, so a fresh clone has no lockfile and `npm ci`
# would fail. Use it when it exists (reproducible) and fall back to `npm install`
# otherwise, so this image builds both in CI and from a working copy.
COPY frontend/package.json frontend/package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; \
    else npm install --no-audit --no-fund; fi

FROM node:22-bookworm-slim AS builder

ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_OUTPUT=standalone
WORKDIR /app

# NEXT_PUBLIC_* is inlined into the browser bundle by Next at build time, so it
# is a build argument here rather than only a runtime variable: changing it
# requires a rebuild, and pretending otherwise produces a bundle that points at
# the wrong host. The default is right for the documented local stack, where the
# browser reaches the API on the host's port 5000.
ARG NEXT_PUBLIC_API_URL=http://localhost:5000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

COPY --from=deps /app/frontend/node_modules ./frontend/node_modules
COPY frontend/ ./frontend/

# The build-time evidence index reads these project documents.
COPY README.md ./README.md
COPY docs/ ./docs/

# scripts/copy-data.mjs reads only allowlisted JSON from backend/artifacts
# (see frontend/scripts/copy-data.mjs). Model pickles and per-household rows
# elsewhere in backend/artifacts/ are deliberately not copied into the image:
# the image must not contain them.
COPY backend/artifacts/ui_graph ./backend/artifacts/ui_graph
COPY backend/artifacts/ui ./backend/artifacts/ui

# Regenerates frontend/data (checked against the manifest) and then builds. A missing
# or malformed artifact fails here, at build time, instead of rendering an
# undefined in a table someone is about to target households with.
WORKDIR /app/frontend
RUN npm run build

FROM node:22-bookworm-slim AS runner

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3001 \
    HOSTNAME=0.0.0.0

WORKDIR /app

# The standalone server never installs anything: node_modules here is the pruned
# tree Next derived from the build, and it is the only dependency set that has to
# exist at runtime.
COPY --from=builder /app/frontend/.next/standalone ./
COPY --from=builder /app/frontend/.next/static ./.next/static

# Next writes to .next/cache when it caches a fetch; the process runs as `node`
# and must not need the root filesystem to be writable anywhere else.
RUN mkdir -p /app/.next/cache && chown -R node:node /app/.next
USER node

EXPOSE 3001

# Node 22 has fetch, so this needs no curl in the image. `/` is the overview
# page, which is static and therefore a real check of the server rather than of
# the API behind it (the API has its own healthcheck).
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3001/').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "server.js"]
