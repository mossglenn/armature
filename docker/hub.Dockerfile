# The Armature hub as a container (Phase 7; ADR-0026 decision 4, ADR-0054).
#
# Build from the repository root, so the workspace packages are in the context:
#   docker build -f docker/hub.Dockerfile -t armature-hub .
# or let docker/docker-compose.yml build it (`docker compose --profile hub up --build`).
#
# Two stages. The first installs the workspace and bundles app/server.ts with
# esbuild (`npm run build:hub`): the API, @armature/types, hono and zod become
# one file. The second holds Node and that file, nothing else: no node_modules,
# no TypeScript, no Next.js. The image serves /api/v1 only; the Next.js pages
# are the demo interface and run elsewhere or not at all.

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
RUN npm run build:hub --workspace app

FROM node:22-alpine
# The source map lets a stack trace in the log name the TypeScript line.
ENV NODE_ENV=production PORT=3100 HOST=0.0.0.0 NODE_OPTIONS=--enable-source-maps
WORKDIR /hub
COPY --from=build /src/app/dist/server.mjs /src/app/dist/server.mjs.map ./
USER node
EXPOSE 3100
# GET /discover needs no store, so it says whether the hub itself is up.
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/v1/discover').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server.mjs"]
