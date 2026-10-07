# ADR-0054: The Armature API is a Hono application

## Status

Proposed (2026-10-07). Amends ADR-0026 decision 1 if accepted. Acceptance is gated on the
verification spike in §Verification before acceptance.

Numbering note: ADR-0027 to ADR-0034 are reserved by `docs/development-plan.md` §5 and ADR-0035 to
ADR-0053 are provisional candidates in `docs/research/adr-candidates.md`. This is the first free
number. Renumber if the candidates are renumbered.

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

4. **Framework features are adopted where the plan already needs them, and nowhere else.**
   - Middleware for identity resolution (ADR-0032, Phase 3) and for reading and echoing the
     `TerminusDB-Data-Version` header (Phase 2).
   - `app.onError` replaces `handleTerminusError`'s `NextResponse` return with a host-neutral
     mapping from TerminusDB error types to HTTP status and body; the mapping logic is kept.
   - Request validation at the boundary with `@hono/zod-validator`, which is the Zod adoption the
     types generator deferred; Zod schemas for request bodies are derived from `schema.json` by the
     generator, not hand-written, so there remains one source of truth. The invariants engine
     (Phase 3) stays separate: validation checks shape, invariants check meaning against the graph.
   - `app.request()` is how the Phase 7 contract test exercises every route against a TerminusDB
     service container, without starting Next.js.
   - Hono's typed client is evaluated as the basis of the Phase 7 `packages/client`; if its inferred
     types are adequate the hand-written fetch wrappers the plan describes are not built.
   - OpenAPI generation is not adopted until a client needs it; `GET /schema` (ADR-0027) is the
     self-description the plan asks for.

5. **Existing routes are not ported ahead of their phase.** The eight GET list routes, the two POSTs
   and the coverage route remain Next.js handlers and die on the plan's schedule (Phase 3 and
   Phase 4). The first Hono routes are the Phase 2 branch, history, diff and read-at-ref routes.
   This ADR is therefore cheapest to accept before Phase 2 and expensive to accept after Phase 5.

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

## Consequences

- The host move is a deployment change in fact, not only in intent. Every route written from
  Phase 2 onward is portable on the day it is written.
- Two routing layers exist while the app is mounted in Next.js: Next's file-system router hands
  `/api/*` to the catch-all, Hono routes within it. The cost is one indirection per request and a
  small adapter dependency; the benefit is that only one file knows about Next.js.
- The Node.js runtime is required; the Next.js edge runtime is not supported by the adapter and is
  not wanted, since the TerminusDB client is Node code.
- `handleTerminusError` and `createGetHandler` in `app/lib/routeHelpers.ts` become legacy with the
  routes that use them and are deleted in Phase 3.
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
