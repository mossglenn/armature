# The Armature viewer as a container (Phase 7): the Next.js pages, a client
# of a hub. It holds no store credentials and only reads; its one setting is
# the hub's address (ARMATURE_HUB_URL, set by docker-compose.yml to the hub
# service on the private network).
#
# Build from the repository root, so the workspace packages are in the context:
#   docker build -f docker/viewer.Dockerfile -t armature-viewer .
# or let docker/docker-compose.yml build it (`docker compose --profile hub up --build`).
#
# Two stages. The first installs the workspace and runs `next build` with
# Next's standalone output (app/next.config.ts), which writes the built pages
# and only the modules they import under .next/standalone. The second holds
# Node and that output.

FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY app/package.json app/
COPY packages/types/package.json packages/types/
COPY packages/client/package.json packages/client/
RUN npm ci --ignore-scripts
COPY app app
COPY packages packages
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build --workspace app

FROM node:22-alpine
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /viewer
# The standalone output keeps the workspace layout: app/server.js beside the
# traced node_modules. The static assets and public files are not traced and
# are copied next to the server, where it serves them from.
COPY --from=build /src/app/.next/standalone ./
COPY --from=build /src/app/.next/static ./app/.next/static
COPY --from=build /src/app/public ./app/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/').then(r=>process.exit(r.status<500?0:1),()=>process.exit(1))"
CMD ["node", "app/server.js"]
