# ADR-0055: The API layer reaches TerminusDB over HTTP, not through the JavaScript client

## Status

Accepted (2026-10-08). Supersedes the 2026-03-03 session decision "keep the JS client, not worth
switching to the raw HTTP API mid-project" and the narrowing of it in `docs/development-plan.md`
§3 ("client for reads and version-control calls, HTTP for authored writes"). Amends the Phase 2
work item "Per-request client and an HTTP write path".

Numbering note: ADR-0025 to ADR-0034 are reserved by `docs/development-plan.md` §5 and ADR-0035 to
ADR-0053 are provisional candidates in `docs/research/adr-candidates.md`. 0055 is the next free
number after ADR-0054.

## Context

Phase 2 replaces the module-level client singleton in `app/lib/terminusdb.ts` with something
request-scoped, and writes the first routes that carry an author, read at a ref, and surface the
store's history, diff and merge. Before that code is written, the question of *how* the API layer
talks to the store needs one answer. So far it has had three, each narrower than the last:

- March 2026: keep the JavaScript client; switching to HTTP mid-project is not worth it.
- October 2026, plan §3: the client cannot set the commit author, so authored writes go over
  HTTP; the client is kept for reads and version-control calls.
- ADR-0054: the API is a Hono application written against Web-standard `Request` and `Response`,
  and nothing under `app/lib/api/` depends on its host.

On 2026-10-08 the installed client source was read in full for the question (`terminusdb@12.0.5`,
`lib/woqlClient.js`, `lib/dispatchRequest.js`, `lib/connectionConfig.js`, `lib/typedef.js`),
following the `terminusdb` skill's rule that the source outranks the docs for client behaviour.
What it shows:

1. **There is one API.** Every client method builds a URL through `ConnectionConfig` and hands
   it to `DispatchRequest`, which is an axios call with a Basic-auth header. The client adds no
   protocol, batching or transaction semantics of its own. "Client versus HTTP" is one server
   contract reached through two call paths.
2. **The author is welded to the connection user.** `addDocument`, `updateDocument` and
   `deleteDocument` overwrite the `author` parameter with `this.author()`, which returns
   `connectionConfig.user()`, the Basic-auth user. `apply` calls `generateCommitInfo(message)`
   without an author, although that helper accepts one. No public method lets a caller set the
   author. The HTTP document API takes `author` and `message` as query parameters on `POST`,
   `PUT` and `DELETE`, and the vendored `commit-message-howto.md` says to pass the end user's
   identity there, distinct from the HTTP auth user that authorises the request.
3. **Request state leaks across calls.** Database, branch, ref and custom headers live on the
   client instance. A write given a `lastDataVersion` stores it with
   `this.customHeaders({ 'TerminusDB-Data-Version': ... })` and nothing clears it, so every later
   request on that instance, reads included, carries the stale header. `copy()` duplicates the
   connection config but not the custom headers, so a fresh copy starts clean. On a singleton this
   is a latent fault; on any shared instance it is a race.
4. **Errors are flattened.** The client throws a plain `Error` whose message concatenates the
   server's JSON error fields. The HTTP response body carries `@type` and the `api:` fields
   intact. The substring matching in `app.onError` and the legacy `handleTerminusError` exists to
   recover what the client discarded.
5. **The data version is opt-in and positional.** The server returns `TerminusDB-Data-Version` on
   every response. The client surfaces it only when the `getDataVersion` positional flag is true,
   which is the `undefined, undefined, '', true` call in the spike route.
6. **The client lags the server.** The history route the plan specifies needs the `diff=true`
   option the server added in v12.0.5. The client's `DocHistoryParams` does not include it. The
   client passes unknown query parameters through, so it would likely work, but the bundled
   TypeScript types reject it and nothing documents it. The client (12.0.5) and server (12.0.7)
   release on separate cadences, and server features reach the HTTP API first by construction.
7. **The client is heavier than the layer it would sit in.** It depends on axios, pako, buffer
   and form-data, and installs a Node `https` agent for loopback addresses. ADR-0054 made the API
   layer host-neutral and Web-standard; global `fetch` is the same standard.
8. **Nothing in the repository's own code uses the client's query builder.** The coverage route
   filters with a document template query, which is a plain `GET` parameter. The scripts use
   `addDocument` with `full_replace`. The WOQL builder, the client's one substantial piece of
   logic, is unused.

The plan's split ("client for reads, HTTP for writes") would therefore keep two error shapes
flowing into one mapper, two places that know the store's path grammar, the sticky-header hazard
on the read path, and two things to re-verify at every server release.

## Decision

1. **One HTTP adapter.** The API layer reaches TerminusDB through a single module under
   `app/lib/api/`, provisionally `app/lib/api/store.ts`, that uses global `fetch`. It owns: the
   base URL and credentials from the environment; path construction for a branch
   (`local/branch/<name>`) or a commit (`local/commit/<id>`); `author` and `message` on every
   write; reading `TerminusDB-Data-Version` from every response and forwarding it on writes when
   the caller supplied one; and parsing error bodies into a typed error that carries the server's
   `@type` and fields. Nothing else under `app/lib/api/` builds a store URL or reads a store error
   body.
2. **Request-scoped by construction.** The adapter is created per request from the resolved ref
   and identity and holds no state beyond them. No module-level instance holds a branch, ref or
   header. This replaces the plan's `getClient({ branch?, ref? })` wording; the shape is the same,
   the implementation is not the client.
3. **The author is the resolved identity, never the body.** The adapter's write methods take the
   author from the identity the request resolved to (ADR-0032, Phase 3; a configured operator
   until then) and the reason from the request. Which string identifies a `User` in a commit is
   ADR-0025's decision; this ADR only fixes where it is set.
4. **The JavaScript client does not appear under `app/lib/api/`.** It stays in `scripts/`, where
   the loader, seed and platform checks run as a single operator and its batch helpers are
   convenient. `app/lib/terminusdb.ts` remains only for the legacy unversioned routes and is
   deleted with them in Phase 3.
5. **One re-admission path.** If a route needs WOQL, the client's `lib/woql.js` may be imported
   to construct the query JSON, which the adapter then posts to the query endpoint. The client is
   never used to dispatch. The first such use amends this ADR naming the route.
6. **Errors are matched on `@type`.** `app.onError` maps the adapter's typed error by the
   server's `@type`, not by substring. The legacy substring mapper dies with the legacy routes, as
   ADR-0054 already records.
7. **The contract is the HTTP API as vendored and verified.** The endpoints and parameters the
   adapter relies on are the ones recorded in plan §9 from `docs/vendor/terminusdb/`. Any endpoint
   or behaviour the adapter uses that §9 does not yet record gets a lettered check in
   `scripts/platform_checks.js` before a route depends on it.

## Alternatives considered

- **Connect as a TerminusDB account per Armature user** so the client's hardcoded author is the
  right one. Rejected. It makes the store the identity provider, which ADR-0015 places outside
  Armature, requires holding store credentials per user, and buys no policy: the store has no
  per-branch or per-type permissions (plan §9), so authorisation is the hub's job either way.
- **Keep the plan's split** (client for reads and version-control calls, HTTP for authored
  writes). Rejected for the reasons in Context: two error shapes, two URL builders, the
  sticky-header hazard on the read path, and double verification work.
- **Use the client's `sendCustomRequest` with its URL builder** so the author can be set while the
  client still dispatches. Rejected. It drops the data-version return, keeps axios and the
  instance headers, and couples the adapter to `ConnectionConfig` internals.
- **Fork or patch the client to accept an author.** Rejected. It adds a maintenance burden to a
  dependency that already lags the server and fixes only one of the eight points above.
- **Reuse `ConnectionConfig` for URL building only.** Rejected. The path grammar is small and
  documented (`graph-spec-db-spec-database-path-identifiers.md`); importing the client for a
  dozen lines of string formatting is not worth the dependency. Its `documentURL`, `docHistoryURL`
  and `applyURL` remain a useful reference while writing the adapter.

## Consequences

- Every store call from the API layer passes through one module. Error mapping, header handling
  and ref resolution are written once and tested once.
- The spike's read route in `app/lib/api/app.ts` and its test are rewritten against the adapter
  as the first Phase 2 code change, before the branch and history routes are added.
- The API layer drops axios, pako, buffer and form-data from its dependency graph. The client
  remains a dependency of `scripts/` and, until Phase 3, of the legacy routes.
- The hub's contract with the store is the vendored HTTP documentation plus plan §9, with no
  translation layer whose behaviour has to be read out of `woqlClient.js`. The sync discipline in
  the `terminusdb` skill matters more as a result: a stale vendored page is now a stale contract.
- Path construction and query-parameter encoding are hand-written. The grammar is small, but
  `author` and `message` must be URL-encoded, and the adapter must set the `Content-Type` and
  `Accept` headers the client set implicitly. The client's gzip compression of bodies over 1 KiB
  is not reproduced; nothing in the demo approaches a size where it matters.
- Two behaviours the adapter relies on are stated in the docs but not yet reproduced by a
  platform check and must be before the routes land (decision 7): the exact error body returned
  when a write carries a stale `TerminusDB-Data-Version` (expected 409, `@type` to be recorded),
  and `diff=true` on the history endpoint returning the per-commit structural diff.
- The plan's §3 diagram line "per-request client bound to one branch or commit" becomes
  "per-request HTTP store adapter bound to one branch or commit". The Phase 2 work item, the
  ADR queue, §9, CLAUDE.md's repository tree and What-Not-To-Do list, SESSION.md's active
  decisions and the `terminusdb` skill are amended with this ADR.
- The data-version token shape exposed by `/api/v1` is unchanged by this ADR and remains
  ADR-0025's decision (ADR-0054 consequences). The adapter sees the store's raw `branch:<commit>`
  token; what the route returns is decided there.
- If the project later needs the WOQL builder (Phase 4's coverage recomputation is the likely
  first case), decision 5 admits it without reopening this ADR's structure: the builder produces
  JSON, the adapter posts it.
