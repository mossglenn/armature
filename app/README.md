# The Armature app

This directory is a [Next.js](https://nextjs.org) application with two jobs:

1. **It hosts the Armature API.** The API itself is a host-neutral [Hono](https://hono.dev) application in `lib/api/` (ADR-0054, an Architecture Decision Record in `schema/docs/adr/`). Next.js serves it under `/api/v1/` through one catch-all route file, `app/api/[[...route]]/route.ts`, the only file that knows Next.js is the host. Moving the API to a standalone server later means adding an entry file that serves the same Hono app, not changing any route (ADR-0026).
2. **It serves Armature's own pages**: a read-only module index (`/`) and the Coverage View (`/coverage/<moduleId>`). The pages call the Hono app in-process with `app.request()`, exactly as a plugin would call the API over HTTP, and never read the database directly.

The project's README at the repository root explains how to start the database and load the demonstration data. [How Armature Works](../docs/how-armature-works.md) explains everything the code does, and the [API reference](../docs/api.md) documents each route.

## Running it

The app needs the TerminusDB container running with the schema and seed loaded (see the root README), and a `.env.local` file in this directory (not committed):

| Variable | Meaning | Local default |
|---|---|---|
| `TERMINUS_URL` | Where TerminusDB listens | `http://localhost:6363` |
| `TERMINUS_USER` | Database account | `admin` |
| `TERMINUS_PASS` | Its password; must match `TERMINUSDB_ADMIN_PASS` given to the container | `admin` |
| `TERMINUS_DB` | Database name | `armature` |
| `ARMATURE_IDENTITY` | Optional. The identity resolver (ADR-0032): `header`, the default, reads `Armature-User: <externalId>` and trusts the caller, so keep the server local | `header` |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the development server on <http://localhost:3000> |
| `npm run build`, `npm start` | Production build and server |
| `npm run lint` | ESLint (runs in CI, continuous integration) |
| `npm test` | The integration tests (Vitest) against the running database; see below |
| `npm run generate:types` | Regenerate `lib/types.ts` and `lib/schemas.ts` from `../schema/schema.json` |
| `npm run check:types` | Fail if those generated files have drifted from the schema (runs in CI) |
| `npm run sync:terminusdb-docs` | Refresh the vendored TerminusDB documentation in `../docs/vendor/terminusdb/` |

## Layout

```
app/
  page.tsx                    The module index
  coverage/[moduleId]/page.tsx  The Coverage View over GET /api/v1/intelligence/coverage/:moduleId
  api/[[...route]]/route.ts   Mounts the Hono app for every HTTP method (the only route file)
  layout.tsx, globals.css     Page shell and styles (Tailwind CSS)
lib/
  api/                        The Armature API (Hono; never imports from next)
    app.ts                    The app: base path /api/v1, route groups, error mapping
    store.ts                  The only module that talks to TerminusDB (ADR-0055)
    http.ts                   Refs (?branch=, ?ref=), ETag and If-Match, write envelopes
    identity.ts               Identity resolution (ADR-0032)
    classes.ts                What the generated schema data says about a class
    write.ts                  The one write pipeline for every type
    errors.ts                 ApiError: status, stable code, message
    invariants/               The invariants engine: rules 0 to 12, one module per constrained type
    intelligence/             The coverage algorithm and the per-request graph reader
    routes/                   documents, branches, users, intelligence
    *.test.ts                 Integration tests (app, write, intelligence)
  types.ts                    GENERATED: TypeScript types plus the schema as data
  schemas.ts                  GENERATED: Zod request schemas, one per writable class
vitest.config.mts             Test configuration: the @ alias, and .env.local so tests hit the same database
```

## Tests

`npm test` runs 95 integration tests that call the Hono app in-process and read from and write to the running TerminusDB container. They create scratch branches and delete them afterward, so `main` and the seed are left as they were. The one exception is the user-registration tests, which must write to `main` (where users live) and remove what they create. The tests are not yet in CI; Phase 7 of the development plan adds a database service container so they can run there.

## Rules for code in this directory

- Nothing under `lib/api/` imports from `next` (ADR-0054).
- Only `lib/api/store.ts` talks to TerminusDB, over HTTP (ADR-0055). The `terminusdb` JavaScript client is a dependency of `../scripts/` only.
- Never edit `lib/types.ts` or `lib/schemas.ts`; change `../schema/schema.json` and regenerate.
- Pages are clients of the API like any plugin: they call `app.request()` and never the store.
