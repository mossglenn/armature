# ADR-0054: The Armature API is a Hono application

> **In brief.** This decision answered: what software framework should Armature's application
> programming interface (API) be written in, so that it can later move out of the Next.js web
> application without being rewritten? It chose Hono, a small framework built on web-standard requests
> and responses, put the whole API in `app/lib/api/`, and made a single Next.js file hand every request
> to it. It still holds and is implemented; the old unversioned routes it left in place were removed on
> 2026-10-08, and several framework features it planned to use (validation and identity "middleware",
> and a `GET /api/v1/schema` address) were done differently or not built, as the notes below record.

## Status

Accepted (2026-10-07). Proposed and verified the same day: the six-check spike in §Verification
before acceptance passed in full (results recorded there). Amends ADR-0026 decision 1.

**Amended 2026-10-08 by ADR-0032 and Phase 3** (decision 4): identity resolution and the
data-version token are handled by functions the routes call, not by middleware, because both
depend on the ref resolved inside the route; request validation is the generated Zod schemas
(`app/lib/schemas.ts`) called in `app/lib/api/write.ts`, and `@hono/zod-validator` is not a
dependency. **Completed 2026-10-08:** decisions 3 and 5 (the legacy routes coexist until Phase 3)
are done; all eleven legacy routes, `app/lib/terminusdb.ts` and `app/lib/routeHelpers.ts` were
removed in Phase 3. The open data-version question in §Consequences was closed by ADR-0025
decision 7, and store access was decided by ADR-0055. `GET /api/v1/schema` (ADR-0027 decision 4),
named in decision 4, is not built.

Numbering note: ADR-0027 to ADR-0034 are reserved by `docs/development-plan.md` §5 and ADR-0035 to
ADR-0053 are provisional candidates in `docs/research/adr-candidates.md`. This is the first free
number. Renumber if the candidates are renumbered.

> **Later change (2026-10-08):** the canonical reserved block is ADR-0024 to ADR-0034
> (`docs/development-plan.md` §5). Of it, 0024 to 0027, 0029, 0032 and 0033 are written; 0028,
> 0030, 0031 and 0034 are reserved and unwritten. The candidates were not renumbered.

## Context

ADR-0026 settled that the Armature API's contract is its URL surface under `/api/v1/`, that the
Next.js route handlers in `app/app/api/` are the host for the current phase, and that a separate
service remains the destination. It left the host itself undecided and said only that handlers must
not depend on Next.js in ways that make extraction costly.

The code already does. Every handler imports `NextRequest` and `NextResponse`, reads path parameters
from Next's `params` promise, and the shared error mapper in `app/lib/routeHelpers.ts` returns a
`NextResponse`, binding the library layer to the host. Nothing enforces ADR-0026's guideline, and the
guideline alone would leave each of the twenty-odd routes Phases 2 to 5 add to be written against the
host and ported later.

The plan's target shape (§3) is five layers: identity and provenance, a generic document API,
an invariants engine, design-intelligence reads, and a typed client generated from the schema. Each
layer wants things a framework normally provides: a router that composes route groups, middleware
for identity resolution (ADR-0032) and for the `TerminusDB-Data-Version` header, request validation
at the boundary, structured error handling, in-process testing without a server, and a typed client
derived from the route definitions (Phase 7). Next.js route handlers provide none of these; they are
a file-system convention over the Web `Request` and `Response` types.

Hono is a small web framework built on exactly those Web-standard types. It runs unchanged on
Node.js, Bun, Deno, Cloudflare Workers and Vercel, and it runs inside a Next.js App Router project
through an official adapter. Facts checked on 2026-10-07 against hono.dev and npm:

- `hono` 4.13.13. Routing, `app.route()` for mounting sub-apps, `basePath()`, middleware,
  `HTTPException` and `app.onError`, `c.json()`, response header control, and `app.request()` for
  invoking the app in-process in tests.
- `@hono/vercel` 1.0.0 exports `handle(app)`. A Next.js App Router project mounts a Hono app from
  `app/api/[[...route]]/route.ts` by exporting `GET`, `POST`, `PUT`, `DELETE` and the other methods
  as `handle(app)`. The documentation states this runs on the Node.js runtime, which is what the
  TerminusDB client needs.
- `@hono/node-server` 2.1.3 serves the same app object as a standalone Node process.
- `@hono/zod-validator` 0.9.1 and `@hono/zod-openapi` 1.6.3 attach schema validation and an OpenAPI
  document to routes. Hono's `hc` client infers a typed client from the app's route types.

## Decision

1. **The Armature API is a Hono application.** It lives in `app/lib/api/` as a plain module:
   `app.ts` creates `new Hono().basePath('/api/v1')` and mounts route groups from
   `app/lib/api/routes/` (documents, branches, users, intelligence, attachments as they arrive).
   Nothing under `app/lib/api/` imports from `next`.

2. **Next.js hosts it through one file.** `app/app/api/[[...route]]/route.ts` exports each HTTP
   method as `handle(app)` from `@hono/vercel`. This is the only file in the repository that knows
   the API is served by Next.js. The host move ADR-0026 anticipates becomes: add an entry file that
   calls `serve(app)` from `@hono/node-server` (or the adapter for whichever runtime), and delete the
   catch-all route. No handler changes.

3. **ADR-0026 decisions 2 to 4 stand unchanged.** The contract is `/api/v1/`; the legacy unversioned
   routes stay as Next.js handlers until Phase 3 retires them (a specific route file takes precedence
   over the catch-all, so they coexist); the triggers for moving to a separate service are as
   written. Decision 1 of ADR-0026 is amended to read: the Next.js app is the host, the Hono app is
   the API.

   > **Later change (2026-10-08):** Phase 3 retired the legacy routes; the catch-all is the only
   > route file.

4. **Framework features are adopted where the plan already needs them, and nowhere else.**
   - Middleware for identity resolution (ADR-0032, Phase 3) and for reading and echoing the
     `TerminusDB-Data-Version` header (Phase 2).

     > **Later change (2026-10-08):** neither is middleware. Identity (`app/lib/api/identity.ts`)
     > and the data-version token (`ETag`/`If-Match` in `app/lib/api/http.ts`) are functions the
     > routes call, because both depend on the ref resolved inside the route (ADR-0032
     > §Consequences). The store's header never reaches `/api/v1` (ADR-0025 decision 7).

   - `app.onError` replaces `handleTerminusError`'s `NextResponse` return with a host-neutral
     mapping from TerminusDB error types to HTTP status and body; the mapping logic is kept.
   - Request validation at the boundary with `@hono/zod-validator`, which is the Zod adoption the
     types generator deferred; Zod schemas for request bodies are derived from `schema.json` by the
     generator, not hand-written, so there remains one source of truth. The invariants engine
     (Phase 3) stays separate: validation checks shape, invariants check meaning against the graph.

     > **Later change (2026-10-08):** `@hono/zod-validator` was not adopted. The generator emits
     > Zod request schemas (`app/lib/schemas.ts`), and the write pipeline calls them directly with
     > `safeParse` (`app/lib/api/write.ts`), a 400 on failure. The split between shape and
     > invariants holds as written.

   - `app.request()` is how the Phase 7 contract test exercises every route against a TerminusDB
     service container, without starting Next.js.
   - Hono's typed client is evaluated as the basis of the Phase 7 `packages/client`; if its inferred
     types are adequate the hand-written fetch wrappers the plan describes are not built.
   - OpenAPI generation is not adopted until a client needs it; `GET /schema` (ADR-0027) is the
     self-description the plan asks for.

     > **Later change (2026-10-08):** `GET /api/v1/schema` has not been built and no phase
     > currently owns it.

5. **Existing routes are not ported ahead of their phase.** The eight GET list routes, the two POSTs
   and the coverage route remain Next.js handlers and die on the plan's schedule (Phase 3 and
   Phase 4). The first Hono routes are the Phase 2 branch, history, diff and read-at-ref routes.
   This ADR is therefore cheapest to accept before Phase 2 and expensive to accept after Phase 5.

   > **Later change (2026-10-08):** all eleven were retired in Phase 3 (the coverage route
   > included), ahead of the Phase 4 date given here; Phase 4 added
   > `GET /api/v1/intelligence/coverage/:moduleId` in its place.

## Alternatives considered

- **Keep Next.js handlers and enforce Web-standard discipline by review.** No dependency, but it
  rebuilds a router, middleware chain, error mapping and test harness by hand, and relies on
  discipline that today's code already lacks. Rejected as the more expensive path to the same
  portability.
- **Stand up Express or Fastify as a separate service now.** Honours PROJECT_CONTEXT's original
  intent but splits the demo into two deployables before anything needs it, and neither framework
  runs on the edge or serverless runtimes without adapters. ADR-0026 already declined this timing.
- **Elysia.** Comparable design, Bun-first; Node support is secondary. Rejected on portability.
- **tRPC.** Typed procedures, not HTTP routes. CoQui and every reference client need plain REST
  with branch and ref parameters that a curl command can express. Rejected.
- **NestJS.** A full application framework with dependency injection and decorators. Far more
  structure than a hub with five layers needs. Rejected on weight.
- **Expose TerminusDB's own HTTP or GraphQL API to plugins.** Ruled out by the plan's P2 and P8:
  the hub is where invariants, identity and the non-aggregation rule are enforced, and the store
  has no per-branch permissions (plan §9). Not a host option at all.

## Verification before acceptance

A one-session spike, on a branch, that:

1. Adds `hono` and `@hono/vercel` to `app/`, creates `app/lib/api/app.ts` with `basePath('/api/v1')`
   and one route, `GET /api/v1/documents/:type/:id`, reading from the running store with the
   existing client singleton.
2. Mounts it from `app/app/api/[[...route]]/route.ts` and confirms the legacy `/api/courses` and
   `/api/coverage/:moduleId` routes still answer (specific route beats catch-all).
3. Returns a response header from the handler and confirms it reaches the client through the
   adapter (`TerminusDB-Data-Version` depends on this).
4. Confirms `npm run build` succeeds on the Node.js runtime and that `npm run lint`,
   `npm run check:types` and `tsc --noEmit` stay clean.
5. Serves the same `app` object with `@hono/node-server` from a scratch entry file and confirms
   the route answers identically on another port, then deletes the entry file.
6. Writes one test that calls `app.request('/api/v1/documents/Module/how-ai-works')` in-process.

If step 2, 3 or 5 fails, the ADR is revised or rejected and ADR-0026 stands as written.

### Spike results (2026-10-07, branch `spike/adr-0054-hono`)

All six checks passed against the running v12.0.7 store with the seed loaded.

| Check | Result | Evidence |
|---|---|---|
| 1. Route works inside Next.js | Pass | `GET /api/v1/documents/Module/how-ai-works` returns the document, HTTP 200; missing id returns `{"error":"Document not found"}`, HTTP 404 |
| 2. Legacy routes coexist with the catch-all | Pass | `/api/courses` and `/api/coverage/how-ai-works` still answer 200 beside `app/api/[[...route]]/route.ts`; unknown paths under `/api/v1` and bare `/api` return Hono's 404 |
| 3. Response header passes through the adapter | Pass | `terminusdb-data-version: branch:<commit>` reaches curl through `@hono/vercel`, so the Phase 2 data-version contract is viable |
| 4. Build, lint, types | Pass | `npm run build` lists `ƒ /api/[[...route]]` beside the legacy routes; `npm run lint`, `npm run check:types`, `tsc --noEmit` clean |
| 5. Same app under `@hono/node-server` | Pass | A six-line scratch entry served `app.fetch` on port 3100 with identical 200 and 404 responses and the same header; entry deleted afterward |
| 6. In-process test | Pass | Three Vitest tests through `app.request()`: seeded module with data version, missing id, id under another type. No HTTP server started |

What the spike added to the repository (the only Hono code until Phase 2):
`app/lib/api/app.ts` (the app, one route, `onError` mapping), `app/app/api/[[...route]]/route.ts`
(the host mount), `app/lib/api/app.test.ts`, `app/vitest.config.mts`, and an `npm test` script.
Dependencies pinned exactly: `hono` 4.13.13, `@hono/vercel` 1.0.0, `@hono/node-server` 2.1.3 (dev),
`vitest` 5.0.3 (dev). `@types/node` moved from 20 to 22 to satisfy Vitest's peer range, matching
CI's Node 22.

Two things learned that the decision did not anticipate:
- The client's `getDocument(..., getDataVersion = true)` returns `{ result, dataVersion }` with the
  branch head as `branch:<commit>`. The route forwards it unchanged. Phase 2 should decide whether
  to expose the raw store token or a hub-shaped one.
- Vitest with Next's `@/` path alias needs one line of alias config, and `.env.local` is read by
  the config so tests hit the same store the app does. The tests are integration tests and need the
  container; they are not in CI until Phase 7 adds a TerminusDB service container.

The gate is satisfied; the ADR was accepted on the result.

## Consequences

Two consequences the decision did not anticipate, found by the spike:

- **The data-version token is the store's, not the hub's.** The client returns the branch head as
  `branch:<commit-id>`, and the spike route forwards it verbatim in `TerminusDB-Data-Version`.
  That leaks the store's token format into the API contract. Phase 2's read-at-ref and
  optimistic-concurrency work must decide whether `/api/v1` exposes the raw token or a hub-shaped
  one (for example the bare commit id, which is also what history and diff routes return), and
  must decide it before CoQui's `httpHub` starts round-tripping the header. Recorded as a Phase 2
  work item and in ADR-0025's scope.
- **Standalone serving needs a build step.** `app/lib/api/` uses the Next.js `@/` path alias,
  which Node cannot resolve on its own; the spike served the app standalone through `tsx`, which
  reads `tsconfig.json`. Phase 7's container entry for `@hono/node-server` therefore needs either
  a bundling or transpile step that resolves the alias, or relative imports inside `app/lib/api/`.
  The former is preferred so that the module keeps one import convention with the rest of the
  app; the choice is made in Phase 7 with the `packages/` split. Until then, "the move is a
  deployment change" means "a deployment change plus a build configuration", which is still not a
  handler change.

Everything else as anticipated:

- The host move is a deployment change in fact, not only in intent. Every route written from
  Phase 2 onward is portable on the day it is written.
- Two routing layers exist while the app is mounted in Next.js: Next's file-system router hands
  `/api/*` to the catch-all, Hono routes within it. The cost is one indirection per request and a
  small adapter dependency; the benefit is that only one file knows about Next.js.
- The Node.js runtime is required; the Next.js edge runtime is not supported by the adapter and is
  not wanted, since the TerminusDB client is Node code.
- `handleTerminusError` and `createGetHandler` in `app/lib/routeHelpers.ts` become legacy with the
  routes that use them and are deleted in Phase 3.

  > **Later change (2026-10-08):** the edge-runtime reason no longer applies: under ADR-0055 the API
  > reaches TerminusDB with the web-standard `fetch`, not the Node-only client. The runtime is still
  > Node.js. `app/lib/routeHelpers.ts` was deleted in Phase 3 as planned.

- The types generator gains a second output (Zod request schemas) when Phase 3's write path lands.
  `check:types` guards both.
- Phase 7's contract test and typed client both get a foundation they would otherwise have to
  build. Phase 7's "containerize the app" item becomes "serve the Hono app with the Node adapter
  in a container"; the Next.js app remains the demo UI and may be deployed separately or not at
  all.
- The plan §3 line "Next.js stays the host for now" is still true. Its parenthetical becomes
  "Hono inside Next.js".
- CoQui is unaffected. It addresses `/api/v1/...` and never sees the host.
- A new dependency with a fast release cadence (Hono is at 4.x; the Vercel adapter reached 1.0 in
  2026). Pin exact versions in `app/package.json` and let CI catch breakage, as the repository does
  for the TerminusDB client.
- ADR-0055 (2026-10-08) decides how the layer this ADR created reaches the store: one `fetch`
  adapter under `app/lib/api/`, with the JavaScript client kept out of it. The spike route's use
  of the client singleton is replaced by that adapter as the first Phase 2 code change.
