# The Armature app

This directory holds two programs that share a package:

1. **The Armature API and its host.** The API is a host-neutral [Hono](https://hono.dev) application in `lib/api/` (ADR-0054, an Architecture Decision Record in `schema/docs/adr/`). `server.ts` serves it as a standalone Node process through `lib/hub.ts` and `@hono/node-server`; `npm run build:hub` bundles it into `dist/server.mjs`, which `npm run start:hub` runs on this machine and the container image in `../docker/hub.Dockerfile` runs anywhere (ADR-0026 decision 4). A running API in front of a store is a **hub**.
2. **The Armature viewer**, a [Next.js](https://nextjs.org) application with two read-only pages, the module index (`/`) and the Coverage View (`/coverage/<moduleId>`). The pages are a client of a hub like any plugin: they read it over HTTP through `@armature/client` (`lib/viewer.ts`) and know only the hub's address. `../docker/viewer.Dockerfile` packages them (Next's standalone output) as the public face of an instance, beside the hub and the store (`../docs/deployment.md`). Until 2026-10-21 Next.js also mounted the API through a catch-all route and the pages called it in-process; that made the viewer a second hub with its own store credentials, and it was removed.

The project's README at the repository root explains how to start the database and load the demonstration data. [How Armature Works](../docs/how-armature-works.md) explains everything the code does, and the [API reference](../docs/api.md) documents each route.

## Running it

The hub needs the TerminusDB container running with the schema and seed loaded (see the root README), and a `.env.local` file in this directory (not committed). The viewer needs only a hub to point at.

| Variable | Meaning | Local default |
|---|---|---|
| `TERMINUS_URL` | Where TerminusDB listens | `http://localhost:6363` |
| `TERMINUS_USER` | Database account | `admin` |
| `TERMINUS_PASS` | Its password; must match `TERMINUSDB_ADMIN_PASS` given to the container | `admin` |
| `TERMINUS_DB` | Database name | `armature` |
| `ARMATURE_IDENTITY` | Optional. The identity resolver (ADR-0032): `header`, the default, reads `Armature-User: <externalId>` and trusts the caller, so keep the server local | `header` |
| `ARMATURE_EXPORT_KEY` | Optional. The key under which `GET /api/v1/export?profile=pseudonymous` derives user tokens (ADR-0031); set it so the same person has the same token in every export, leave it unset and each export mints its own | unset |
| `PORT`, `HOST` | The hub (`npm run start:hub` and the container): where it listens. Loopback by default because the `header` resolver trusts the caller; the container sets `HOST=0.0.0.0` inside its own network and `docker-compose.yml` confines what is published | `3100`, `127.0.0.1` |
| `ARMATURE_HUB_URL` | The viewer only: the hub its pages read. The one variable the viewer needs; it reads no `TERMINUS_*` | `http://localhost:3100` |
| `ARMATURE_HUB_PUBLIC_URL` | The viewer only, optional: the hub's address as a reader's browser could reach it, for the raw-data links in page footers. Unset, a `localhost` hub is linked as itself and any other is not linked at all, so a hub kept private behind the viewer stays private | unset |

The hub reads `.env.local` from its working directory as Next.js does (a variable already set in the environment wins); the container has no such file and takes everything from `docker-compose.yml`, which publishes its port on loopback only by default (`ARMATURE_HUB_BIND`), because the `header` resolver trusts the caller.

## Scripts

| Command | What it does |
|---|---|
| `npm run build:hub` | Bundle the hub: esbuild over `server.ts` into `dist/server.mjs`, the API and its packages in one file (runs in CI) |
| `npm run start:hub` | Run that bundle: the API on port 3100 |
| `npm run build:operator` | Bundle the operator tools (ADR-0062): esbuild over `operator.ts` into `dist/operator.mjs` (runs in CI; the hub's image carries it) |
| `npm run operator -- <command>` | Build and run them against the store in `.env.local`: `check`, `delete`, `put`; `-- --help` lists the options, `docs/deployment.md` § Repair says when to use each |
| `npm run dev` | Start the viewer's development server on <http://localhost:3000>, reading the hub at `ARMATURE_HUB_URL` |
| `npm run build`, `npm start` | The viewer's production build and server |
| `npm run lint` | ESLint (runs in CI, continuous integration) |
| `npm test` | The integration tests (Vitest) against the running database; see below |
| `npm run typecheck` | `tsc --noEmit` (runs in CI) |
| `npm run sync:terminusdb-docs` | Refresh the vendored TerminusDB documentation in `../docs/vendor/terminusdb/` |

## Layout

```
server.ts                     The hub's entry: reads the environment, starts lib/hub.ts, stops on SIGTERM
operator.ts                   The operator tools' command line (ADR-0062): check, delete, put
dist/                         The bundles (npm run build:hub, npm run build:operator); generated, not committed
app/                          The viewer (Next.js); no route files, it hosts no API
  page.tsx                    The module index
  coverage/[moduleId]/page.tsx  The Coverage View over GET /api/v1/intelligence/coverage/:moduleId, with each item's statistics from /intelligence/item-statistics at the same commit
  layout.tsx, globals.css     Page shell and styles (Tailwind CSS)
lib/
  viewer.ts                   The viewer's hub: hubUrl() from ARMATURE_HUB_URL and viewerHub(), a read-only @armature/client
  hub.ts                      The API served by Node's HTTP server (@hono/node-server): startHub({ port }) for server.ts and the test
  hub.test.ts                 The standalone host over a real socket: the same answers as app.request(), headers included
  envLocal.ts                 Reads .env.local into the environment, for server.ts and operator.ts
  operator/                   The operator tools: check.ts (every rule over a whole branch), repair.ts (delete, put), their test
  api/                        The Armature API (Hono; never imports from next)
    app.ts                    The app: base path /api/v1, route groups, error mapping
    store.ts                  The only module that talks to TerminusDB (ADR-0055)
    http.ts                   Refs (?branch=, ?ref=), ETag and If-Match, write envelopes
    identity.ts               Identity resolution (ADR-0032)
    classes.ts                What the generated schema data says about a class
    write.ts                  The one write pipeline for every type
    errors.ts                 ApiError: status, stable code, message
    invariants/               The invariants engine: rules 0 to 19, one module per constrained type
    intelligence/             The coverage algorithm and the per-request graph reader
    routes/                   documents, branches, users, intelligence, export
    export/                   The export's slices (slices.json) and profiles (ADR-0031)
    *.test.ts                 Integration tests (app, write, intelligence, export)
vitest.config.mts             Test configuration: the @ alias, and .env.local so tests hit the same database
```

## Tests

`npm test` runs 175 integration tests that call the Hono app in-process (and, in `lib/hub.test.ts`, over a socket to the standalone host on an ephemeral port) and read from and write to the running TerminusDB container. They create scratch branches and delete them afterward, so `main` and the seed are left as they were. The one exception is the user-registration tests, which must write to `main` (where users live) and remove what they create. They are the contract suite: CI runs them against a TerminusDB service container on every push and pull request (`.github/workflows/ci.yml`, the `contract` job: wait for the store, load the schema, seed, `npm test`). The files run one at a time (`fileParallelism: false`): each writes to its own scratch branch, but every commit lands in the database's one commit graph, and files writing in parallel made the store give up a transaction once in CI. `vitest.global-setup.mts` waits until the seeded database answers a read of `main`, then warms the store with the tests' kind of work (a scratch branch, one write, one coverage read, the branch deleted afterward) before the first test file starts, since a store on a cold machine has stalled mid-suite past the test timeout while a cheap read answered at once; `vitest.env.ts` reads `.env.local` for both the setup and the workers.

## Rules for code in this directory

- Nothing under `lib/api/` imports from `next` (ADR-0054).
- Only `lib/api/store.ts` talks to TerminusDB, over HTTP (ADR-0055). The `terminusdb` JavaScript client is a dependency of `../scripts/` only.
- The types and the Zod request schemas come from `@armature/types` (`../packages/types`, a workspace package generated from `../schema/schema.json`); never edit them, change the schema and run `npm run generate:types` at the root.
- Pages are clients of a hub like any plugin: they read it over HTTP through `lib/viewer.ts` and never import `lib/api/` or touch the store.
