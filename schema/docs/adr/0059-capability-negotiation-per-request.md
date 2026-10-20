# ADR-0059: Capability Negotiation Per Request

> **In brief.** This decision answers: how does a tool built against Armature's application
> programming interface (API) find out what a particular hub supports, and what happens when the
> two disagree? It proposes that nothing is negotiated up front. Every request names the contract
> revision it was written against and, when it matters, the capabilities it relies on; the hub
> answers each request on its own, refusing with a list of what it does support when it cannot
> honor one. A tool that wants to ask first can call one discovery route. The design is taken from
> the Model Context Protocol's 2026 revision, which solved the same problem for the same kind of
> connection. (ADR stands for Architecture Decision Record.)

## Status

Proposed (drafted 2026-10-20). Nothing is built on it. Adopts the *capabilities* half of research
candidate ADR-0039 ("API evolution: capabilities, projections and cadence",
`docs/research/adr-candidates.md`); the candidate's versioned projections and release cadence
stay candidates, since no breaking shape change has yet been needed. Resolves the deferral in
ADR-0026's consequences ("whether and how versions are negotiated beyond the prefix").

Built in Phase 7 of `docs/development-plan.md` with the typed client package, or earlier if the
first trigger in the Consequences arrives. Acceptance is a separate step; see Open.

## Context

ADR-0026 made `/api/v1` the whole of the version contract: every route lives under the prefix,
and a breaking shape change would go under a new one. It deferred everything finer than that.
Since then the API has grown by phases (generic writes in Phase 3, the intelligence reads in
Phase 4, attestations in Phase 5), each adding routes, fields, rules and error codes under the
same prefix, each recorded for clients in `docs/client-changes.md`. A client has no way to ask a
hub which of these it has, and no way to fail deterministically against a hub that lacks one. It
finds out by sending the request and reading a 404 or a 400 `invalid_document`.

Three reference clients (`docs/development-plan.md` §2) make this a hub concern and not a CoQui
one:

- the **outcomes importer** and the **course builder** run unattended, often on a schedule,
  against a hub someone else deploys; an unattended run must know before writing whether the hub
  understands `LearningMetric.subject` or `Attestation`;
- the **AI design assistant** runs inside another tool and may meet several hubs; it should
  degrade (propose without attesting) rather than fail;
- CoQui's `httpHub` already carries a version check of its own design, which Phase 7's typed
  client is meant to replace.

Every client needs the check, so it passes the two-client test (CLAUDE.md principle 6).

**Why the obvious precedent does not fit.** Candidate ADR-0039 named the Language Server
Protocol's `initialize` exchange as the model: a client opens a connection, declares what it can
do, the server answers with what it supports, and both remember the answer for the life of the
connection. Armature has no connection to remember it in. Every request is independent: it
carries `Armature-User`, a branch or commit, and an optional `If-Match`; the Hono app builds a
store adapter for that request, answers, and forgets (ADR-0054, ADR-0055). The statelessness is
deliberate: it lets the Next.js pages call the app in-process, lets any host serve the same
handlers, and makes the Phase 7 move to a separate process a deployment change. Holding a
negotiated capability set would need a session, sticky routing or a token, each of which the
architecture has avoided.

**The precedent that does.** The Model Context Protocol (MCP) began with an `initialize`
handshake and added a stateless HTTP transport that could not keep one. Its revision of
2026-07-28 removed the handshake ("Versioning and Compatibility",
`modelcontextprotocol.io/specification/2026-07-28/basic/versioning`):

- every request declares the protocol version it uses, in the message's `_meta` field and, on
  HTTP, in an `MCP-Protocol-Version` header;
- a server that does not implement that version answers `UnsupportedProtocolVersionError`
  carrying `supported` (a list) and `requested`; the client picks one and retries;
- a `server/discover` method exists, and a client *may* call it first but need not;
- optional extensions are advertised in an `extensions` map keyed by namespaced identifiers with
  a mandatory prefix in reverse domain-name form (`io.modelcontextprotocol/ui`), each with a
  settings object; when one side supports an extension the other does not, the supporting side
  must either fall back to core behavior or reject the request, and each extension documents
  which.

Versions are dates, not numbers, and the version string is a revision of the whole contract.
This was found during the precedents survey of 2026-10-20
(`docs/research/Armature Schema Precedents and Plugin Candidates.md`, Part 2 §6).

## Decision

1. **No handshake and no session.** A request is answered on its own content. The hub keeps
   nothing about a client between requests, and no route depends on an earlier one having been
   called.

2. **The contract has dated revisions.** The API contract (`docs/api.md`) is revised under the
   `/api/v1` prefix, and each revision that changes what a client sends, receives or must do is
   dated, as `docs/client-changes.md` already dates them. The revision identifier is that date,
   `YYYY-MM-DD`. The prefix stays the boundary for a breaking shape change (ADR-0026 decision 2);
   revisions within a prefix are additive or are rules a client may need to know about.

3. **A request may name the revision it was written against,** in an `Armature-Version` header.
   The hub answers one of three ways:
   - the revision is one it serves: the request proceeds;
   - the revision is older than the oldest it serves, or unknown: **400** `unsupported_version`,
     with `requested` and `supported` (the revisions it serves, newest first) in the body, so the
     client can pick one and retry or report it;
   - no header: the request proceeds under the hub's current revision. Until Phase 7's client
     exists every client omits it, and a hub must not break them.

   Every response carries the revision it was served under, in an `Armature-Version` response
   header, beside `ETag`.

4. **Capabilities are named features of hub behavior, with namespaced identifiers.** A
   capability is always something a hub does, whoever defined it; the hub never calls a plugin,
   so there is no list of what a plugin can do and none is wanted. An identifier is
   `<prefix>/<name>`, and the prefix names the party that *defined* the capability, not the one
   that implements it. The hub's own capabilities carry the prefix `armature`. A capability
   defined by anyone else carries a reverse domain name its owner controls, so names cannot
   collide and the hub keeps no registry: a plugin-owned extension a hub preserves through a
   replace (candidate ADR-0040; `edu.example.coqui/review-notes`), a validator or read one
   deployment adds (`edu.example/retention-policy`), or a feature a standard body or a second
   hub implementation defines. Names are stable: a capability is added, never renamed, and
   retired only under a new prefix.
   This settles the naming question candidate ADR-0039 left open (`coverage.read` and the like
   become `armature/intelligence.coverage`). The first set names what exists:
   `armature/documents`, `armature/branches`, `armature/users`,
   `armature/intelligence.coverage`, `armature/intelligence.alignment`,
   `armature/intelligence.trace`, `armature/intelligence.impact`,
   `armature/intelligence.attestations`. Each capability has a settings object, empty when it
   has nothing to say; a capability whose behavior has parameters (the coverage thresholds, the
   list route's page size) reports its defaults there.

5. **A request may declare the capabilities it relies on,** in an `Armature-Capabilities`
   header: a comma-separated list of identifiers. The header carries what the client is about
   to depend on, never what the client offers; unlike MCP, where each side advertises to the
   other because each may call the other, Armature's declaration flows one way, from client to
   hub. For each identifier:
   - the hub supports it: nothing changes;
   - the hub does not support it: the hub either serves the request under core behavior or
     refuses it with **400** `unsupported_capability` naming the identifiers it lacks. Which of
     the two is fixed per capability by its definition, as MCP requires of each extension, and
     recorded in the discovery response (decision 6) as `fallback: "ignore" | "reject"`. The
     hub's own capabilities are all `reject`: a client that says it relies on attestations and
     reaches a hub without them should not write at all. A plugin-defined capability chooses
     (candidate ADR-0040's `modifier` flag is the same distinction).

   Declaring is optional. A client that declares nothing gets core behavior and finds out the
   old way. The header exists so that an unattended client can fail before its first write, in
   one round trip, with an error that names the gap.

6. **One discovery route, `GET /api/v1/discover`,** answering without a ref and without
   identity: `{ versions: [...], capabilities: { "<id>": { fallback, ...settings } },
   schema: { route: "/api/v1/schema" } }`, where `versions` is the list from decision 3 and
   `schema` points at the route ADR-0027 decision 4 scheduled and no phase has yet built. A
   client may call it first; none has to, since every other route answers the same questions
   inline through decisions 3 and 5. Discovery describes the hub, not the graph: it is the same
   at every ref.

7. **Shape is not negotiated.** Nothing in this decision lets a client ask for an older shape of
   a document or a response. A change that would need that goes under a new prefix, as ADR-0026
   says, and whether a hub then serves both prefixes as projections of one graph is the
   candidate's second half, still open. This keeps the decision small: a version is a fact a
   client states, a capability is a feature it tests for, and both are answered per request.

## Alternatives considered

- **An `initialize` exchange, as LSP does it** (candidate ADR-0039 as written). Needs a session;
  see Context. Rejected.
- **A new prefix for every change (`/api/v2`, `/v3`).** Every additive change becomes a breaking
  one for the client's configuration, and every client pins a whole contract to get one feature.
  ADR-0026 reserved the prefix for breaking shape changes; this decision keeps that meaning.
- **Media-type negotiation (`Accept: application/vnd.armature.v1+json`).** Standard HTTP, but
  it is per representation, not per feature; it says nothing about rules or error codes; and the
  version disappears from logs and links. A header that names the contract revision is plainer.
- **A `?version=` query parameter.** Mixes the contract revision into the address a client reads
  a document at, which `ETag` and `?ref=` already load with meaning. Rejected.
- **An OpenAPI document only.** It describes a hub; it does not let a request say what it
  assumes or let the hub refuse on that basis. Worth generating in Phase 7 regardless, as the
  discovery response's long form; it is not a substitute.
- **Capabilities without a version, or a version without capabilities.** MCP keeps both and so
  does this decision: the version says which contract revision a client read, the capabilities
  say which features it relies on. A hub two revisions ahead still serves a client that relies
  only on documents and branches; a hub one revision behind refuses, by name, the one feature it
  lacks.

## Consequences

- **Nothing changes for any client until this is built.** Both headers are optional and absent
  today; the discovery route does not exist. The first trigger to build it is the earliest of:
  Phase 7's typed client package, which will send `Armature-Version` on every call; a plugin that
  must run against two hub deployments at different revisions; or the first hub deployment
  outside this repository's demo.
- **When built:** `docs/api.md` gains a conventions section for the two headers, the discovery
  route and the two error codes; `docs/client-changes.md` gains an entry; the hub's capability
  list is maintained beside the routes, and a route added without a capability fails a test. The
  `Armature-Version` response header is set in one place, beside `ETag`, in the adapter or
  `app.ts`.
- **`docs/client-changes.md` becomes the revision log.** Its dated entries are the revisions
  decision 2 names, so the list a hub reports in `supported` is derived from a record that
  already exists.
- **The `/api/v1` prefix keeps its meaning.** Additive changes and new rules are revisions; a
  breaking shape change is a new prefix. Candidate ADR-0039's projections and cadence halves are
  decided when the first such change is proposed, not before.
- **Plugin-defined capabilities get a name before they get a home.** The reverse-domain prefix in
  decision 4 is what candidate ADR-0040 (extension model) will key its extensions by, so the two
  decisions compose; this one does not decide where plugin-owned data lives.
- **`GET /api/v1/schema` gets an owner by implication.** Discovery points at it, so it lands in the
  same unit of work (ADR-0027 decision 4, plan §6).

## Open

- Whether the hub should answer `unsupported_version` for a revision *newer* than its own, or
  serve it under the current revision and let the response header tell the client. MCP refuses
  any version it does not implement. Refusing is safer for an unattended writer; serving is
  kinder to a human in a browser. Decide at acceptance.
- Whether CoQui's existing version check should be replaced by the client package or simply
  read `Armature-Version` from responses. CoQui's call, at its boundary.

## Related

- ADR-0026 (API host and route versioning): the prefix this decision builds under; its deferral is
  resolved here.
- ADR-0027 (schema self-description): `GET /api/v1/schema`, which discovery points at.
- ADR-0054 and ADR-0055: the stateless shape this decision preserves.
- Research candidates ADR-0039 (adopted in part) and ADR-0040 (extension model; composes with
  decision 4).
- Model Context Protocol specification, revision 2026-07-28: "Versioning and Compatibility"
  (`basic/versioning`), "Lifecycle" (`basic/lifecycle`), the `MCP-Protocol-Version` header
  (`basic/transports/streamable-http`) and `server/discover`. Read 2026-10-20.
- `docs/research/Armature Schema Precedents and Plugin Candidates.md` (2026-10-20), Part 2 §6,
  where the precedent was identified; the same section lists the VS Code extension manifest and
  Obsidian's `minAppVersion` as the minimal contract a client package can carry before any of
  this is built.
