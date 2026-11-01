# The Armature hub as a container (Phase 7; ADR-0026 decision 4, ADR-0054).
#
# Build from the repository root, so the workspace packages are in the context:
#   docker build -f docker/hub.Dockerfile -t armature-hub .
# or let docker/docker-compose.yml build it (`docker compose --profile hub up --build`).
#
# Two stages. The first installs the workspace and bundles app/server.ts with
# esbuild (`npm run build:hub`): the API, @armature/types, hono and zod become
# one file. The second holds Node and that file, nothing else: no node_modules,
# no TypeScript, no Next.js. The image serves /api/v1 only; the viewer, a
# client of the hub, has its own image (viewer.Dockerfile).
#
# The operator tools (ADR-0062) are bundled the same way from app/operator.ts
# and sit beside the server, because the hub's container is where the store's
# credentials already are: `docker compose exec hub node operator.mjs check`.

FROM node:22-alpine AS build
WORKDIR /src
# The manifests first, so the install layer is reused while only sources change.
COPY package.json package-lock.json ./
COPY app/package.json app/
COPY packages/types/package.json packages/types/
COPY packages/client/package.json packages/client/
# esbuild's binary is an optional platform package, so no install scripts are needed.
RUN npm ci --ignore-scripts
COPY app app
COPY packages packages
RUN npm run build:hub --workspace app && npm run build:operator --workspace app

FROM node:22-alpine
# The source map lets a stack trace in the log name the TypeScript line.
ENV NODE_ENV=production PORT=3100 HOST=0.0.0.0 NODE_OPTIONS=--enable-source-maps
WORKDIR /hub
COPY --from=build /src/app/dist/server.mjs /src/app/dist/server.mjs.map /src/app/dist/operator.mjs /src/app/dist/operator.mjs.map ./
# A workspace hub keeps its records here (ARMATURE_WORKSPACE_DIR in the compose
# file's `workspace` service); a named volume takes this folder's owner.
RUN mkdir /workspaces && chown node:node /workspaces
USER node
EXPOSE 3100
# GET /discover needs no store, so it says whether the hub itself is up.
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/v1/discover').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server.mjs"]
