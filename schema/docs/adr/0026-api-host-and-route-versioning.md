# ADR-0026: API host and route versioning

## Status

Accepted (2026-10-07). Decision 1 is proposed for amendment by ADR-0054 (the API as a Hono
application mounted inside Next.js); decisions 2 to 4 are unaffected by that proposal.

## Context

`PROJECT_CONTEXT.md` lists "Separate API service (not Next.js API routes in CoQui)" among the
technical decisions already made, and `CLAUDE.md` described the Armature API as "a Node.js (Express
or Fastify) service" with an `api/` directory "to be built". Meanwhile every route that exists lives
in the Next.js app under `app/app/api/`, and the only client, CoQui, is being written against those
routes. The repository therefore contradicted itself about where the API is, and the open question
"Express vs. Fastify" had been answered by default rather than decided.

The architectural point behind "separate service" still stands: the API is the boundary between
plugins and TerminusDB, and the demo narrative depends on that boundary being visible. What does
not follow is that the boundary must be a separate process today. The boundary is a URL contract.

## Decision

1. **The Next.js route handlers in `app/app/api/` are the Armature API for the current phase of
   development** (Phases 0 to 6 of `docs/development-plan.md`). There is no `api/` directory and no
   Express or Fastify service. That open question is closed: neither is chosen, because no separate
   process exists to need one.

2. **All new routes are mounted under a versioned prefix, `/api/v1/`.** The generic document API,
   branch, history, diff, user and intelligence routes the plan describes all land there. The
   version segment is part of the contract a client depends on; the host serving it is not.

3. **The existing unversioned routes** (`/api/courses`, `/api/coverage/:moduleId` and the rest)
   are legacy. They are kept working until Phase 3 retires or aliases them, and no client should be
   written against them.

4. **A separate API service remains the destination.** The move happens in Phase 7 or when one
   of these triggers appears first:
   - a plugin that cannot or should not depend on a Next.js deployment;
   - the hosted demo needing the API to scale or deploy independently of the demo UI;
   - a second host (CLI, batch importer) needing the same route code without Next.js.

   Because clients address `/api/v1/...` and never the host, the move is a deployment change:
   the same handlers behind a different server, with the prefix preserved.

## Consequences

- `PROJECT_CONTEXT.md` and `CLAUDE.md` describe one stack. The "Express vs. Fastify" open question
  is removed.
- Clients (CoQui's `httpHub`, the Phase 7 typed client) are written against `/api/v1/` only.
  Changing the host later does not change them.
- The versioned prefix gives the project a place to make a breaking shape change without breaking
  existing clients. Whether and how versions are negotiated beyond the prefix is deferred to the
  API-evolution candidate (ADR-0039 in `docs/research/adr-candidates.md`).
- Route handlers must not depend on Next.js-only features in ways that would make extraction
  costly. Handlers take a request and return a response; TerminusDB access goes through `app/lib/`.
  A future extraction lifts `app/lib/` and the handlers together.
- The legacy unversioned routes carry a documented expiry (Phase 3) so they do not become a second
  contract by accident.
