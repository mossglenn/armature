# Armature API reference

This document describes every route of the Armature API (application programming interface) as built; [`client-changes.md`](client-changes.md) dates each addition (newest revision 2026-11-01). The code is the authority: routes are defined in `app/lib/api/routes/`, conventions in `app/lib/api/http.ts`, and error mapping in `app/lib/api/app.ts`. For the reasoning behind the design, see [How Armature Works](how-armature-works.md) Part III and the Architecture Decision Records (ADRs) cited below.

## Conventions

### Base path and versioning

Every route is under `/api/v1`. The version segment is part of the contract; a change that would break existing clients goes under a new version (ADR-0026). When the hub runs locally the full address is `http://localhost:3100/api/v1/...` (`npm run start:hub` in `app/`, or the `hub` container in `docker/docker-compose.yml`). The Next.js app on port 3000 is the viewer, a client of the hub; it serves no API. A workspace hub (Discovery, `role`) serves the same API at its own address, `http://localhost:3101` in the compose file's `workspace` profile.

Within the prefix the contract has dated **revisions** (ADR-0059): each dated entry in [`client-changes.md`](client-changes.md) is one, named by its date, `YYYY-MM-DD`. Revisions are additive, so a hub serves every revision up to its newest. Nothing is negotiated up front and the hub keeps nothing between requests; each request is answered on its own:

- **`Armature-Version: <revision>`** (request, optional) names the revision the client was written against. A revision the hub serves: the request proceeds. Older than the oldest it serves, or not a revision at all: **400** `unsupported_version`, with `requested` and `supported` (the revisions served, newest first). Newer than the newest it serves: a read (`GET`) proceeds under the hub's current revision; a write is **400** `unsupported_version`, since it may rely on a rule this hub does not enforce. No header: the request proceeds under the current revision.
- **`Armature-Version: <revision>`** (response, always) says which revision served the answer, beside `ETag`, on errors too.
- **`Armature-Capabilities: <id>, <id>`** (request, optional) declares the hub features the client is about to rely on, by identifier (`armature/documents`, `armature/intelligence.coverage`, …; a feature someone else defines carries a reverse domain name, `edu.example/…`). One the hub lacks: **400** `unsupported_capability`, with `unsupported` and `supported`. Every capability the hub defines is `reject`: it is never silently served under core behavior.
- **`GET /discover`** answers the same questions in one call for a client that wants to know before its first write; see [Discovery](#discovery). The `@armature/client` package sends `Armature-Version` on every call and returns the response header as `version`.

### Reading at a ref

Every read happens at a **ref**, a named state of the design:

- `?branch=<name>` reads the latest commit of a branch (default: `main`);
- `?ref=<commit-id>` reads the design exactly as it was at that commit (read-only).

Passing both is a 400 (`ambiguous_ref`). A commit identifier that does not exist is a 404 (`unknown_ref`). Writes always go to a branch; `?ref=` on a write is a 400 (`write_at_commit`).

A read that reads the store more than once (every intelligence read, the export) resolves `?branch=` to the branch's head once, when it starts, and reads everything at that commit, so a commit landing on the branch while it runs changes nothing in the answer, and the answer's `ETag` names the one commit all of it is from (since 2026-10-31; the deep review's B1). A client whose view combines several responses reads the later ones at the first one's commit (`?ref=`), as the viewer does.

### The commit in every response: `ETag`

Every response that read from or wrote to the database carries the commit it was served from or created, as a standard `ETag` header holding a bare commit identifier: `ETag: "<commit-id>"`. (ADR-0025 decision 7. TerminusDB's own version header never appears in this API.)

### Optimistic concurrency: `If-Match`

A write may send `If-Match: "<commit-id>"`, meaning "apply this only if the branch is still at this commit." If anyone has committed to the branch since, the write is refused with **412** (`precondition_failed`), and the body carries `expected` and `current` commit identifiers. The token is the branch head, not a fingerprint of one document, so a 412 may mean someone changed a different document; re-read and retry. Writes to a branch take their turn in the hub's write queue, so writes reaching it at the same moment with one `If-Match` land one and answer the rest 412 (ADR-0025 decision 7, note of 2026-11-06). `If-Match: *` (HTTP's "the resource exists") is refused with 400 `bad_if_match`, since a branch head cannot express it (since 2026-10-31; it was read as no condition). Without `If-Match`, a write is not conditioned on what the client read, but it is checked and committed at one commit: the hub conditions it on the head its rules were checked at, and if a commit from outside the queue (a second hub on the store, the operator tools) lands in between, runs the whole write again on the new head, up to three runs, then answers **409** `branch_moved` with nothing written (since 2026-10-31; the deep review's B2). A write refuses rather than overwrites when a commit landing after it arrived, while it waited or in that race, changed a document it replaces: **409** `document_moved` with `documents`, `checked` and `current` (since 2026-11-01; ADR-0025 decision 7, notes), so a concurrent edit of the same record is never silently undone; read again and write with `If-Match`. A write arriving after that commit has landed is not concurrent with it and replaces it, unconditioned as it asked to be. "Arrived" is the branch's head as the document routes read it first thing, before the caller is resolved and their authority judged (since 2026-11-16; until then it was read after both, so a replace that committed during them was overwritten by one that had arrived before it, both answered 200). A stale `If-Match` is refused before the write's rules are checked, so its 412 comes before a `type_conflict` or an `invariant_violation`. `If-None-Match` is not supported.

### Identity: `Armature-User`, or a bearer token

Every route that changes data needs an identity (ADR-0032), and under `oidc` every route but `GET /discover` does (below). Under the default `header` resolver, the request carries `Armature-User: <externalId>`, the external identifier of a registered `User` (the seed registers `demo-designer@example.edu`). The hub resolves it to a `User` document on `main`, records that user as the commit author, and sets `createdBy` on documents it creates. Missing header: **401** `identity_required`. Unregistered identifier: **401** `unknown_user`.

Since 2026-11-01 a request may also carry `Armature-Agent: <agent externalId>`, a registered agent `User` (one whose `externalId` begins with `agent:`), under every resolver (ADR-0067 decisions 3 and 8). The person in `Armature-User` is resolved first and the agent second: the agent is the commit's author and the `createdBy` of what it creates, the person's authority decides the request (below), and the hub appends `Armature-On-Behalf-Of: <person externalId>` to the commit message. An agent that is not registered: **401** `unknown_agent`; a person named as the agent: **400** `not_an_agent`; an agent's identifier in `Armature-User` beside `Armature-Agent`: **400** `not_a_person`. A request naming an agent directly in `Armature-User` may read; on a remote hub it may not write, create a branch, merge, delete, grant or register: **403** `forbidden` with `credential` naming the agent (ADR-0067 decision 10, since 2026-11-01). An agent's own work reaches a remote only as a workspace hub's push, acting for the workspace's owner (Workspace).

**A workspace hub's pairing key (ADR-0065 decision 7, since 2026-11-03).** Every request to a workspace hub that is not a read (any method but GET, HEAD and OPTIONS) also carries `Armature-Local-Token: <value>`, the hub's secret for its tools (the program's pairing key). The desktop program draws it once and keeps it in the system's keychain, so it stays the same across restarts until **Reset** draws a new one (ADR-0065 decision 7, later change of 2026-11-05); when the keychain cannot be read, the program draws one for that start only and keeps nothing. A tool the program launched reads it from its environment as `ARMATURE_LOCAL_TOKEN`, a tool started elsewhere has it pasted once from what the program shows. A workspace hub started without the program (`app/server.ts`) draws and prints a new one at each start, or takes `ARMATURE_LOCAL_TOKEN` (`deployment.md`, "A workspace hub on this machine"). A write without it, or with another value, is **403** `forbidden` with `reason: local_token`, checked before identity; reads need nothing. It says only "a tool the program started": identity stays `Armature-User`'s, and a workspace hub still authorizes nothing. A remote hub neither requires nor reads the header. `GET /discover` says `localToken: required` under `armature/workspace`.

**Authorization (ADR-0068, since 2026-11-01).** Once the identity is resolved, a remote hub checks that it may do what it asks, from the `Grant` documents in force on `main` (the Grants section), and refuses with **403** `forbidden`, naming the missing `permission` (`create`, `write`, `merge`, `delete`, `grant`, `register` or `write_requirement`) and, as it applies, the `branch`, the `role`, `agent` or `locked`. An agent acting for a person may do what the person may. A workspace hub does not check grants; it keeps each workspace to its owner (**403** `forbidden` with `owner` for anyone else, since 2026-11-01), warns at creation when the remote would refuse the owner, and leaves the refusal to the remote's push (ADR-0068 decision 9; Workspace). The capability `armature/authorization` in `GET /discover` says the hub authorizes.

The `header` resolver trusts the caller. While it is configured, the hub is reachable only from its own server (its port on loopback; `deployment.md`), and a tool that writes runs there or behind a proxy that authenticates and sets the header itself.

**The `oidc` resolver (OpenID Connect; ADR-0067 decision 1, since 2026-11-05).** A hub under `ARMATURE_IDENTITY=oidc` takes no `Armature-User`: every request carries `Authorization: Bearer <token>`, a JSON Web Token the instance's identity provider signed, which the hub verifies against the provider's published keys, checking the issuer and the audience `GET /discover` names (`identity.issuer`, `identity.audience`), the expiry, and the algorithm (`RS256`, `ES256` or `EdDSA`). Every request needs one, reads included; `GET /discover` and the health probes (Discovery) alone stay open. No token: **401** `identity_required`; a token the hub refuses: **401** `invalid_token` with `reason` (`expired`, `audience`, `issuer`, `signature`, `algorithm`, `unknown_key`, `not_yet_valid`, `malformed`); both carry `WWW-Authenticate: Bearer`. The token's times are read with thirty seconds of tolerance for a clock that disagrees with the provider's (since 2026-11-16; with none, a hub a few seconds behind refused a token just issued as `not_yet_valid`). A person's token resolves by `(issuer, sub)`: `sub` is the `externalId`, and a `User` registered under `oidc` carries `issuer`, so a `User` registered without one (the seed's) is never a token's subject. First sign-in registers a person, once however many requests arrive together, from the token's `name` and `email`, only when `ARMATURE_OIDC_ADMIT` admits the token: it lists issuers and email domains, a domain matched against the token's `email` only when the token says it is verified (`email_verified: true`, since 2026-11-12; a provider that omits the claim is listed as an issuer), and empty admits no one. Otherwise a valid token is **403** `not_registered` until an administrator registers the person with `POST /users`, which under `oidc` gives a person the hub's own `issuer` when none is named (since 2026-11-12). A service's token, issued to a program with no person present by the client credentials grant (decision 4), names its client in `azp` or `client_id` and carries no `name`, and is a service's only when the instance lists that client (`ARMATURE_OIDC_SERVICES`, since 2026-11-12; decision 4's note of that day); it resolves to the agent `User` whose `externalId` is `agent:<client id>`, registered by a person as any agent is (**401** `unknown_user` until then), and reads only (decision 10). Any other token is a person's: one without a `name` resolves only to a person an administrator registered, and is otherwise **401** `unknown_user` with a message naming the missing claim. `Armature-Agent` works beside a person's token exactly as under `header`. An issuer whose keys or metadata cannot be read, or answer an error: **503** `issuer_unreachable`, never a refusal of the token. Under `oidc` the list of everyone registered is kept for a maintainer of `main` or an administrator, and a full export to anyone else, a relay included whoever it names, carries only the users its records name (Users; Export). Native sign-in (decision 2) is not built yet; a workspace hub runs under `header` and signs in to its remote from its host.

**A relay (ADR-0067 decision 5, since 2026-11-05).** A service may deliver a person's earlier work as the person's, which is how an outbox drains after the reviewer has gone: it sends its own token and `Armature-User: <person externalId>`, and the hub resolves the person as the author, the `createdBy` and the `attestedBy`, appending `Armature-Relayed-By: <agent externalId>` to the commit message. Only a service whose agent `User` holds an active `Relay` grant on `main` (Grants) may do it, and only for the people the grant names in `relayedUsers` (any registered person when absent), on a branch the grant covers (`branch`; every branch when absent), as documents (`PUT` and `POST /documents`): the person's own grants then decide the write, as for anyone. Every other refusal is **403** `forbidden` with `reason: relay` and `relayed` naming the person: `Armature-User` beside a person's token, a service with no `Relay` grant, a person the grant does not name, a branch it does not cover, an action that is not a document write (a branch, a merge, a grant), or `Armature-Agent` beside the relay. A person the relay names who is not registered: **401** `unknown_user`; an agent named: **400** `not_a_person`. `GET /users/me` under a relay answers the person, with `relayedBy`.

### A workspace's link: `Armature-Workspace-Link`

Since 2026-11-20 (ADR-0072 decision 3). A desktop hub sends its installation's identifier on every call to its remote, and the remote takes a write to a workspace's branch only from the installation the workspace is linked to (Workspaces): **409** `held_elsewhere` or `not_linked` otherwise, after identity and authorization. No other client sends it, and on a branch that is no workspace it is ignored.

### Hosts and web origins

Every request is checked before anything else (ADR-0067 decision 7, since revision 2026-10-30). The hub answers a request whose `Host` is a loopback name (`localhost`, `127.0.0.1`, `[::1]`, or a name under `.localhost`, any port) or a name listed in `ARMATURE_ALLOWED_HOSTS`; any other is **403** `host_not_allowed`, so a web page that points its own domain at the hub's machine (DNS rebinding) is refused. A request with an `Origin` header, which browsers send, is **403** `origin_not_allowed` when the origin is `null` or a remote web origin not listed in `ARMATURE_ALLOWED_ORIGINS`; loopback origins and non-web schemes such as `tauri://localhost` (a desktop shell) are served. Only a listed origin gets CORS (cross-origin resource sharing) answers: `OPTIONS` preflights (204), and `Access-Control-Allow-Origin` with `ETag` and `Armature-Version` exposed on every response, refusals included. Tools outside a browser send no `Origin` and need nothing.

### Write envelopes

Every write body is a JSON object with a required, non-empty `message`: the reason for the change, stored as the commit message and returned by the history route byte for byte, git-style trailers included (verified 2026-10-30, platform check AJ). Two trailers are the hub's own (ADR-0067 decision 6): it writes `Armature-On-Behalf-Of: <person>` when an agent acts for a person and `Armature-Relayed-By: <agent>` when a service relays a person's earlier work (Identity; since 2026-11-05), and refuses a message carrying a line that begins with either, **400** `reserved_trailer`, as it does the two the merge gate writes, `Armature-Check` and `Armature-Check-Override` (since 2026-11-15; `POST /branches/:name/merge`); every other trailer is the caller's claim, kept as sent (`Co-Authored-By: <name>` for someone who contributed without signing in; the workspace trailers of ADR-0065 decision 5 when push exists). A write without a message is a **400** `message_required`. A request body may be at most 10 MiB (10,485,760 bytes), checked before it is read; a larger one is a **413** `body_too_large` (since 2026-10-31). The other fields depend on the route: `{ message, document }`, `{ message, documents }`, `{ message, from }`, `{ message, user }`. Branch creation takes `{ name, from }` with no message; since 2026-11-01 it commits the caller's `Owner` grant on `main` under a message the hub writes, and so needs an identity (Branches).

### Document identifiers

A document's identifier is `Type/local-part`, such as `LearningObjective/distinguish-ai-approaches`. In route paths the type and local part are separate segments: `/documents/LearningObjective/distinguish-ai-approaches`.

- **Artifacts** may be given an identifier by the client on first write; later writes under it replace the document (ADR-0024). Without one, the store mints one.
- **Relationship (junction) documents** derive their identifier from their key fields, so a client never supplies one; writing the same key fields again replaces the document. Supplying an `@id` on one is a 400 (`bad_id`). An `Attestation` is one of these: its key is its `subject`, `fragmentId`, `claimRef` and `attestedBy`, and an absent optional field is part of the key (ADR-0028). Write one through `POST /documents`.
- An identifier that already belongs to a document of another type is a **409** (`type_conflict`).

### Errors

Every error body has the shape `{ "error": "<stable code>", "message": "<human text>", ...details }`. The codes are listed at the end of this document.

---

## Documents

### `GET /documents/:type`

Lists the documents of a type at a ref, optionally filtered.

| Query parameter | Meaning |
|---|---|
| `branch` or `ref` | The ref (see conventions) |
| `<field>=<value>` | Keep documents whose field equals the value; for a multi-valued field, documents whose set contains it. On a numeric or boolean field the value must be in its exact form: digits with an optional sign for an integer, and an optional fraction for a decimal (`0.38`, not `.38` or `1e1`), `true` or `false` for a boolean; anything else is 400 `bad_query` (since 2026-10-31) |
| `count`, `skip` | Paging: at most `count` documents, after skipping `skip`; digits only, else 400 `bad_query` |

Returns an array of documents. Unknown type: 404 `unknown_type`. A filter on a field the type does not have, or on an embedded part: 400 `unknown_field`. A filter on a field that names a person (`createdBy`) on a design record: 400 `person_filter_refused`, because the API does not list documents by who made them (ADR-0021); `Grant`, outside `DesignRecord`, is listed by `user` (ADR-0068 decision 8, since 2026-11-01).

Filters on required single-valued fields are applied by the database (for example `/documents/Assessment?module=Module/how-ai-works`). The database cannot answer a filter on an optional enumerated or reference field, or on a multi-valued one (platform check Y), so the hub lists the type and applies those filters itself, then pages (for example `?assesses=`, `?generatedBy=`, `?bloomsLevel=`). The result is the same either way; the second form reads the whole type, which matters only for very large types.

### `GET /documents/:type/:id`

Reads one document at a ref. The document is returned as stored, with embedded parts (fragments) inline. 404 `not_found` if no document of that type has that identifier (including when the identifier belongs to another type).

### `PUT /documents/:type/:id`

Creates or replaces one document on a branch.

- Query: `?branch=` (default `main`).
- Headers: `Armature-User` (required), `If-Match` (optional).
- Body: `{ "message": "...", "document": { ...fields } }`. The document's `@id` and `@type` may be omitted; if given they must match the path (400 `id_mismatch`, `type_mismatch`). Only artifact and relationship types can be written (400 `invalid_type`).
- Response: `{ "id": "<Type/id>", "commit": "<commit-id>" }`, with the commit in `ETag`.

See [the write pipeline](#the-write-pipeline) for the checks applied.

### `POST /documents`

Writes up to 500 documents in **one commit** that succeeds or fails as a whole.

- Query: `?branch=` (default `main`).
- Headers: `Armature-User` (required), `If-Match` (optional).
- Body: `{ "message": "...", "documents": [ ... ] }`. Each document must carry its `@type`. A document can mark itself `"@capture": "<name>"` and another document in the same request can refer to it as `{ "@ref": "<name>" }`; this is how a request creates a junction document and a note about it together, since the junction's identifier is not known until it is written.
- Response: `{ "commit": "<commit-id>", "ids": [ ... ] }`, the written identifiers in input order.
- Errors specific to batches: 400 `duplicate_id` (one identifier twice), 400 `duplicate_capture`.

### `GET /documents/:type/:id/history`

The commits on a branch that touched one document, newest first.

| Query parameter | Meaning | Default |
|---|---|---|
| `branch` | The branch (a `ref=` is refused: 400 `branch_required`) | `main` |
| `start`, `count` | Paging | 0, 20 |
| `diff` | Include the structural difference each commit made; `diff=false` omits it | true |

Response: `{ id, branch, start, count, entries: [ { commit, author, message, timestamp, diff } ] }`, with `ETag` the branch head the history was read at (since 2026-10-23; the store's own history answer names no commit). The store reads history only at a branch (platform check AM2), so the hub reads the head before and after: the same head both times proves the answer is that commit's, since history is never rewritten, and only such an answer is served. If the head moves around three reads in a row, the answer is **503** `branch_busy` with `Retry-After: 1` (since 2026-10-31). The hub keeps an answer by that head and serves it again while the head stands still, since the store walks the branch's whole log for a document touched rarely (seconds on a few hundred commits) and a read at a commit is immutable. `timestamp` is seconds since the epoch as a number, as the store records a commit (here and on a branch head). `message` is the write's `message` as stored, trailers included (platform check AJ). `diff` is TerminusDB's JSON patch (`docs/vendor/terminusdb/json-diff-and-patch.md`), passed through unchanged; every store under a hub produces it (ADR-0066 decision 5, accepted 2026-11-02; a workspace hub over the file-backed store emits the same operations, since 2026-11-02, with a list's segmentation possibly differing where several chains say the same thing). Lists inside a document (such as an item's options) are compared by position, so reordering reads as several changes.

### `GET /documents/:type/:id/diff?from=<commit>&to=<commit>`

The structural difference in one document between two commits, as TerminusDB's JSON patch (`docs/vendor/terminusdb/json-diff-and-patch.md`), passed through unchanged; every store under a hub produces it (ADR-0066 decision 5, accepted 2026-11-02; the file-backed store's segmentation of a list may differ, its operations do not, except inside a JSON value). Inside a JSON value, a `CheckRequirement`'s `params`, the operations may differ too, and both shapes apply (ADR-0070 decision 12): TerminusDB patches a list of objects of equal length as a plain array with one patch per position, `[{}, { "on": { "@op": "SwapValue", ... } }]`, an empty object for an element unchanged, where a workspace hub's store gives a `CopyList`, `PatchList`, `KeepList` chain for the same change. A client that applies patches reads an array where a list was as positional patches, and keeps any element past its end. An absent side is `null` in this format, so a key set to `null` inside a JSON value reads as a key removed. Both are required (400 `range_required`) and must exist (404 `unknown_ref`). Response: `{ id, from, to, diff }`.

### The write pipeline

`PUT /documents/:type/:id` and `POST /documents` run the same steps (`app/lib/api/write.ts`), after the permission check (Identity; ADR-0068): a document in the batch needs the right to write the branch, a `Grant` the right to grant that role on that branch, and a `CheckRequirement` the right to require a check of merges into the branch it names (Check requirements), else **403** `forbidden` before anything is read.

1. **Shape.** Each document is checked against a validation schema generated from `schema/schema.json`: required fields, field kinds, allowed enum values, minimum set sizes, no unknown fields, every string non-empty and at most 10,000 characters. Failure: **400** `invalid_document` with an `issues` list (`{ index, path, message }` per problem).
2. **Identity of the document.** An identifier held by another type: **409** `type_conflict`. An existing document (found by `@id`, or for a junction by its key fields) makes this write a replace. Before the lookup, an `Attestation` without `attestedBy` gets the resolved user, since the attester is part of its key: a re-attestation finds the caller's own record, never another person's.
3. **Provenance.** `createdBy` is set to the resolved user on create and preserved on replace (a value in the body is ignored). On a branch that lacks the user's `User` document, a copy from `main` is written in the same commit. `asOf`, the commit a `LearningDataset`, `LearningMetric` or `DesignFinding` refers to (ADR-0057), is filled when the body omits it: on create, with the branch head the write starts from (the `If-Match` commit when one is sent); on replace, with the stored value, except for an `Attestation`, whose every write is a new verdict and takes the head again (ADR-0028 decision 5); on a metric with a `derivedFrom` dataset, with the dataset's value. A body may supply `asOf`, for example when importing historical results, and rule 13 checks it.
4. **Rules.** Every invariant is checked against the branch as it will be after the write. Failure: **422** `invariant_violation` with every violation at once, as `violations: [ { code, id?, index, field?, message } ]`.
5. **One commit**, authored by the resolved user (the agent, under `Armature-Agent`) with the request's message, the hub's `Armature-On-Behalf-Of` trailer appended when an agent acted for a person. Steps 2 to 4 read the branch at its head as the write began (the `If-Match` commit when one is sent, else **412** before step 2), and the commit is accepted only onto that head: when another lands first, a write with `If-Match` is a **412**, and one without runs steps 2 to 5 again on the new head, up to three runs, then **409** `branch_moved`; a rerun that would overwrite a document the winning commit changed is **409** `document_moved` instead (since 2026-11-01).

The rules, numbered as in `.claude/CLAUDE.md`:

| # | Rule | Violation code |
|---|---|---|
| 0 | Every reference names an existing document of the declared class or a subclass | `unknown_reference`, `unknown_capture`, `reference_class` |
| 1 | *Retired 2026-10-20 (ADR-0060).* An item may assess no objective; the alignment read lists such items | none |
| 2 | `LearningActivity.targets` has at least one objective | 400 `invalid_document` (shape) |
| 3 | Module content positions are unique across activity links and lesson links in a module | `duplicate_sequence` |
| 4 | Activity positions are unique within a lesson | `duplicate_sequence` |
| 5 | Item positions are unique within an assessment | `duplicate_sequence` |
| 6 | Lessons are flat | follows from rule 0 |
| 7 | Coverage is never stored | nothing to check; the schema has no coverage field |
| 8 | `fragmentId` is unique across an item's stem, options and feedback | `duplicate_fragment_id` |
| 9 | Option text, where present, is unique within an item; option count and number of correct options suit the item type (a picture option has no text; rule 19 checks it has an attachment) | `duplicate_option_text`, `option_count`, `correct_option_count` |
| 10 | A placement is not `Approved` while its item is `Draft` or `InReview`, in either direction | `instance_ahead_of_item` |
| 11 | A `Dismissed` finding has a `resolutionRationale` | `rationale_required` |
| 12 | An identifier is not reused across types | 409 `type_conflict` |
| 13 | An `asOf` not taken from the branch head is a commit the database holds, at which the record's subjects exist (a dataset's `producedBy`, a metric's `subject`, a finding's `subject` and `regarding`, an attestation's `subject`); a metric's `asOf` equals its dataset's. An attestation's subject is not written in the same request, since `asOf` could not then hold it | `unknown_commit`, `absent_at_commit`, `as_of_disagrees`, `subject_in_same_write` |
| 14 | An attestation's claim comes whole: `claimRef` and `claimText` both present, or both absent for an endorsement | `claim_incomplete` |
| 15 | An attestation's `attestedBy` is the caller | `attester_not_caller` |
| 16 | A `fragmentId` on an `Attestation`, `DesignNote` or `DesignFinding` names a part of its one subject: at `asOf` when that is checked, otherwise as the write leaves the subject | `fragment_needs_one_subject`, `unknown_fragment` |
| 17 | Within an activity, formative uses of items never share a `sequence` (`ActivityItemLink`, ADR-0061) | `duplicate_sequence` |
| 18 | An `Attachment` is a verifiable coordinate: `revision` is present when `store` is `Git` or `Lore`, and `contentHash` is lower-case hexadecimal of the length `hashAlgorithm` implies for the algorithms the hub knows (`sha-256`, `sha-512`, `sha-384`, `sha-224`, `sha-1`, `md5`, `blake2b-256`, `blake2b-512`, `blake2s-256`, named as in the IANA Named Information Hash Algorithm Registry); an unknown algorithm is accepted unchecked. Checked on the artifact's `attachments` and on every fragment's (ADR-0030) | `revision_required`, `hash_malformed` |
| 19 | A fragment carries `text` or at least one attachment (ADR-0030) | `empty_fragment` |
| 20 | A `LearningDataset` names its source, `producedBy` or at least one `externalRef`; a `LearningMetric` names `derivedFrom` or at least one `externalRef` (ADR-0063) | `dataset_without_source`, `metric_without_source` |
| 21 | A `Grant` lives on `main`, whatever branch the work is on; judged by the branch a write is for, so the operator's `put` on `main` passes (ADR-0068 decision 2) | 400 `grants_live_on_main`, before anything is read |
| 22 | A grant's holder suits its role: `Maintainer` and `Administrator` are persons, `Relay` is an agent; `relayedUsers` appears only on a `Relay` grant and names persons (ADR-0068 decision 2) | `grant_holder_kind`, `relayed_users_not_relay` |
| 23 | A `CheckRequirement` lives on `main`, whatever branch it binds, judged by the branch a write is for as rule 21 is (ADR-0070 decision 5; since 2026-11-12) | 400 `requirements_live_on_main`, before anything is read |
| 24 | A `CheckRequirement`'s `reporter` is an agent, the one whose runs count (ADR-0070 decision 5; since 2026-11-12) | `reporter_not_agent` |
| 25, 26 | Held for ADR-0071 (external alignment), proposed | |
| 27 | A `Workspace` and a `MergeRequest` live on `main`, as rules 21 and 23 keep their classes there; both are written by the hub alone (ADR-0072 decisions 2 and 5; since 2026-11-20) | 400 `workspaces_live_on_main`, `merge_requests_live_on_main`, before anything is read |
| 28 | At most one `Active` `Workspace` record names a branch; a `Closed` one keeps a name that may be used again | `workspace_exists` |
| 29 | A workspace's `parent` names a branch no `Active` record names, and not its own branch: a workspace takes nothing but its own push | `parent_is_workspace` |
| 30 | A link comes whole: `link` and `linkedAt` together, `linkLabel` only with them, none on a `Closed` record | `link_incomplete` |
| 31 | At most one `Open` `MergeRequest` names a source and a target | `request_open` |
| 32 | An `Open` request's target is a branch, never a workspace, nor its own source | `target_is_workspace` |
| 33 | A decision comes whole: none of `decidedBy`, `decidedAt` and `mergeCommit` on an `Open` request; all three on a `Merged` one; who and when, and no commit, on a `Closed` one | `decision_incomplete` |

Every `ArmatureDocument` may carry `externalRefs` (identifiers in other systems: `{ "@type": "ExternalRef", system, identifier, label? }`) and `attachments`; every fragment may carry `attachments` (`{ "@type": "Attachment", store, storeUri, contentHash, hashAlgorithm, revision?, path?, container?, mediaType?, byteSize?, role?, label? }`). Both are embedded subdocuments: send them inline, never store their nested `@id`, and expect the field to be absent on read when the set is empty. The hub checks their shape and rules 18 and 19; it does not fetch bytes or verify a hash in this phase (ADR-0030).

There is no route that deletes a document. Lifecycle changes are status changes (`ItemStatus.Retired`, `FindingStatus.Dismissed`, `ObjectiveState.Archived`), which keep every reference and every line of history; deletion is an administrative operation outside the API (ADR-0024 decision 5; ADR-0062 built that operator surface on 2026-10-22: a delete as a commit, a whole-branch rule check, and a replace that can skip the hub's rules, run in the hub's container and none of it on `/api/v1`; `docs/deployment.md` § Repair). A deleted document reads as 404 `not_found`, and its id may be written again.

Rules 27 to 33 are met by the hub's own writes and by the operator's `put`, since no document route takes either class; the routes answer 28, 29, 31 and 32 first, as 409s with the same codes (Workspaces, Merge requests). A write to a workspace's branch carries its link, judged after the permission check and before the pipeline (409 `held_elsewhere`, `not_linked`; Workspaces).

---

## Branches

### `GET /branches`

Every branch with its latest commit: `[ { name, head: { commit, author, message, timestamp, metadata? } } ]`. A branch deleted by another request while the list is being read is left out.

### `POST /branches`

Creates a branch. Body: `{ "name": "...", "from": { "branch": "main" } }` or `{ "name": "...", "from": { "commit": "<commit-id>" } }`; `from` defaults to `main`. Names must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$` (400 `bad_name`). An existing name: 409 `branch_exists`; a `from` branch or commit that does not exist: 404 `unknown_ref`. Response **201**: `{ name, from, head }`. Headers: `Armature-User` (required since 2026-11-01). Any registered person may create a branch, and whoever does owns it (ADR-0068 decision 3; an agent as the credential itself may not, **403** `forbidden` with `permission: "create"`, ADR-0067 decision 10): before the branch exists the hub writes the caller's `Owner` grant on `main`, as a commit of its own, so a branch cut from `main` starts at the commit that records its owner. Under `Armature-Agent` the person owns it.

**As a workspace** (since 2026-11-20; ADR-0072 decisions 1 and 2). With `"workspace": { "link": "<installation>", "linkLabel"?: "..." }` the branch is a *workspace*: a branch linked to one installation of the desktop app, written on the hub only by that installation's desktop hub. `link` is the installation's identifier, 16 to 128 letters, digits, hyphens or underscores, which the app draws once (**400** `bad_link` otherwise); `linkLabel` is a name its owner gave that computer, one line of at most 100 characters, and nothing is sent unless they set one. A workspace is created from a branch, its *parent*, which it takes updates from and sends its merge requests to: `from` a commit is **400**, and `from` a workspace is **409** `parent_is_workspace` with `parent`. The `Workspace` record is written on `main` in the commit that writes the owner's grant, before the branch exists, so a failure between the steps leaves a record for a branch that does not exist (which `check` reports and the next creation of that name closes), never a workspace's branch without its record. Response: as above, with `workspace: { parent, linked: true }`. Workspaces, below, has the record and how a workspace is moved.

### `GET /branches/:name`

The branch's latest commit: `{ name, head }`, with the commit in `ETag`.

### `POST /branches/:name/merge`

Merges another branch into `:name` with the database's three-way merge (ADR-0025 decision 5), **checked before it commits** (since 2026-11-01; decision 5's note of 2026-10-30): the source is applied onto a transient branch cut at the target's head, the invariants engine runs over the whole result, and only a result that breaks no rule is applied onto the target, so two clean branches can no longer merge into a violation such as `duplicate_sequence`. A result that breaks a rule is **422** `invariant_violation` with `violations`, `base`, `source` and `target`, the target unchanged. The transient branch (`operator-merge-…`) is deleted on every outcome; one left by a crash is reported by the operator's `check` and deleted by its scratch-branch deletion. The store's `apply` takes no precondition (platform check AK), so the target's head is read again just before the merge lands and a branch that moved meanwhile is **409** `branch_moved`. That read and the landing are in the branch's write queue, so what remains of the window, one request wide, is a second hub or the operator tools. The check itself is outside the queue, so a merge can lose to a write that lands during it.

- Headers: `Armature-User` (required).
- **Through a merge request** (since 2026-11-20; ADR-0072 decision 5): a merge whose target is `main`, and a merge whose source is a workspace, is **409** `request_required` with `source`, `target` and `reason` (`into_main` or `from_workspace`), unless it is a dry run. Open a merge request and merge that (Merge requests, below). A merge between two branches other than `main` is made here, directly, and so is a merge *into* a workspace, which is its update from its parent and carries its link: `Armature-Workspace-Link` (409 `held_elsewhere` or `not_linked` otherwise; Workspaces).
- Who may (ADR-0068 decision 4, since 2026-11-01): into a branch, its owner or a maintainer of it or of every branch; into `main`, a maintainer of `main` or of every branch; else **403** `forbidden` with `permission: "merge"`. A branch with no owner is open to any registered user while the migration window is open (Grants).
- Headers: `If-Match` (optional, since 2026-11-01): the target head the caller inspected; **412** `precondition_failed` when it moved.
- Body: `{ "message": "...", "from": "<source branch>", "dryRun"?: true, "overrides"?: [ { "check": "...", "reason": "..." } ] }`.
- Success: `{ commit, base, source, target, upToDate: false }`, with `checks` when requirements applied (The merge gate, below). The merge commit records the merged source commit in its metadata (`armature.mergeSource`).
- Dry run (`dryRun: true`, since 2026-11-01): **200** `{ base, source, target, upToDate, dryRun: true, conflicts, violations }` and nothing committed, whatever it finds; the merge would land when both lists are empty. An up-to-date dry run carries `commit` (the target head) and empty lists. When requirements apply it also carries `checks` and `bringInFirst`, and the merge would land only when no required check is unsatisfied and `bringInFirst` is false.

**The merge gate** (ADR-0070 decisions 6 and 7; since 2026-11-15). When `CheckRequirement`s in force apply to the merge, those naming the target, those `locked`, filtered by `fromPrefix` against the source (`GET /checks/requirements?target=&from=` answers which), the merge must satisfy each `Required` one:

1. **The source holds the target's head**, so the merged state is the source's head and a verdict on that commit is a verdict on what lands. Otherwise **409** `bring_in_first`, answered before the merge is checked: merge the target into the source, let the checks run on the result, then merge. Commits on the target that changed only the records kept on `main` alone (grants, check requirements, users, workspace records, merge requests) do not count (since 2026-11-20): no branch writes those, and opening a merge request is itself such a commit on `main`.
2. **A run counts at the source's head**: posted by the requirement's `reporter` with the requirement's current `paramsHash`. A run by anyone else, or under other settings, is advisory and does not count; the newest that counts is the one read. With none, **409** `checks_pending` with `pending`, the checks' names: wait on the event feed and ask again.
3. **That run concludes `pass` or `neutral`.** Otherwise **422** `checks_failed` with `failed`, the target unchanged; it is answered before `checks_pending` when both hold, since waiting will not help.

All three refusals carry `base`, `source`, `target` and `checks`, one verdict per requirement that applied: `{ check, requirement, level, locked, reporter, paramsHash, conclusion, run?, satisfied, overridden? }`, where `conclusion` is the run's or `pending`, `run` is `{ id, reportedAt, summary?, detailsUrl? }` and `satisfied` is step 3's answer. An `Advisory` requirement has a verdict and never refuses. A conflict or a broken rule is answered before steps 2 and 3.

`overrides` takes a required check on the caller: `[{ check, reason }]`, each check once, each reason given and at most 1,000 characters, each naming a required check of this merge (**400** `bad_request` otherwise). Whoever may perform the merge may override an unlocked requirement; a locked one needs an administrator (**403** `forbidden` with `permission: "override_check"`, `branch`, `check` and `locked`). An override is used only where its requirement is not satisfied, and then spares that requirement all three steps.

The merge commit records what it relied on, in its message, as trailers the hub writes and refuses from clients (**400** `reserved_trailer`):

```
Armature-Check: lint/team pass run=<id> params=sha256:<hash>
Armature-Check: structure/spof fail run=<id> params=sha256:<hash> overridden
Armature-Check: style/advice pending params=sha256:<hash> advisory
Armature-Check-Override: structure/spof reason="<the reason given, on one line>"
```

One `Armature-Check` per requirement that applied, one `Armature-Check-Override` per override used. A merge made through a merge request also carries `Armature-Merge-Request: <MergeRequest id>` (since 2026-11-20), written and refused the same way. The runs are held in memory and forgotten at a restart; the trailers are in the commit graph for as long as the commit is. A merge no requirement applies to behaves as before: no `checks` in its answer, no trailer on its commit. **A merge whose source is `main` is not gated**: it is how a branch brings `main` in, which step 1 asks for, and what `main` holds passed the gate into `main`. A workspace hub merges nothing (`remote_only`), so this gate is a remote hub's, and a workspace hub's is its push (Workspace); discovery's `armature/checks` says which in `gate`.

A commit an operator made outside this API (ADR-0062) carries `armature.operator` in its metadata instead: `{ "tool": "put" | "delete", "rulesSkipped": true | false }`. It appears wherever a head's `metadata` does; a document's history shows the operator's message, which says when the hub's rules were skipped.
- Already merged: `{ commit: <target head>, base, source, target, upToDate: true }`, with no new commit.
- No shared history: 409 `no_common_ancestor`.
- Conflict: **409** `merge_conflict` with `{ base, source, target, conflicts }`. Each conflict is either `{ id, field, base, target, source }` (both sides changed a field; the three values) or `{ id, op: "InsertConflict" }` (both sides created the same identifier with different content). Nothing is resolved automatically; the target branch is unchanged.

### `GET /branches/:name/changes?since=<commit>`

The documents inserted, deleted or updated on the branch since a commit: `{ branch, from, to, changes: [ { id, op } ] }` where `op` is `insert`, `delete` or `update`. `since` must be in the branch's history, read from `to`: on its log, or brought in by a merge (the merge commit's `mergeSource`, followed into the merged commit's own log, and so on); a commit the branch never held is a 400 `not_an_ancestor` (since 2026-10-31). The hub walks at most 5,000 commits of any one log; a longer history is a 500 `history_too_long`, never read as a shorter one (here, in a merge's base and in a branch delete's search for a holder).

### `GET /branches/:name/log?start=&count=`

The branch's commits, newest first, paged (`start` 0, `count` 20, at most 100: 400 `bad_query` above it): `{ branch, head, start, count, commits: [ { commit, author, message, timestamp, metadata? } ] }`, each entry in the head's form, with `ETag` the head. The head is read first and the log listed from that commit back (platform check AM1), so every page of one read is the same head's, and a page requested after a commit landed carries the new head in `ETag`. `message` is as stored, trailers included (platform check AJ); this is where a workspace hub's push recovery reads its own `Armature-Workspace-Commit` trailers, and where a research reading of design process lists a branch's work (`docs/workspace-hub-plan.md` §12). Since 2026-11-01. A branch with no commits is 404 `not_found`; an unknown branch 404 `unknown_ref`.

### `DELETE /branches/:name`

Deletes a branch, under three rules (ADR-0025 decision 6, amended): `main` is never deleted (400 `protected_branch`); a branch is deleted only when another branch already holds its latest commit (otherwise 409 `unmerged_branch` with its `head`); there is no force option. Its owner, or a maintainer of it or of every branch, may delete it (**403** `forbidden`, `permission: "delete"`, otherwise; ADR-0068 decision 4). Before the branch goes, every grant naming it is revoked in one commit on `main` (decision 3), so a failure between the two never widens authority. Headers: `Armature-User` (required), `If-Match` (optional; 412 if the branch moved). If a commit lands during the check: 409 `branch_moved`. A branch already deleted, including by a concurrent request: 404 `unknown_ref`. Another branch deleted during the check is skipped as a holder. Response: `{ deleted, head, heldBy }`.

**A workspace's branch** (since 2026-11-20; ADR-0072 decisions 3 and 4). A workspace linked to a computer is deleted from that computer: the request carries `Armature-Workspace-Link`, and is **409** `held_elsewhere` without it or with another. One linked to no computer is deleted by whoever may delete it, with no link. The commit that revokes the branch's grants also closes its `Workspace` record (`status: "Closed"`, after which the name may be used again) and closes every open merge request that names the branch as its source or its target.

There are no reset, squash or rebase routes: shared history is never rewritten.

---

## Workspaces

On a remote hub, under `armature/branches` (ADR-0072 decisions 1 to 4, 6 and 7; since 2026-11-20). A *branch* is on the hub: any client with the right writes it directly, and it takes merges. A *workspace* is a branch linked to one installation of the desktop app. Its branch on the hub is written only by that installation's desktop hub (its push, its update from its parent, its removal), it is personal, in that only its owner writes it, and it is readable as every branch is. Its work leaves it only through a merge request into its parent. The store's branches carry no metadata, so what makes a branch a workspace is a record on `main`:

```
{ "@type": "Workspace", "@id": "Workspace/<uuid>",
  "branch": "<name>", "owner": "User/...", "parent": "<branch>",
  "link"?: "<installation>", "linkedAt"?: "<time>", "linkLabel"?: "<a name for that computer>",
  "status": "Active" | "Closed" }
```

The hub writes every `Workspace` record itself, each change a marked commit on `main` by the caller. No client writes one through the document routes (**400** `invalid_document` or `invalid_type`); it is read there like any document on `main` (`GET /documents/Workspace?status=Active`), `link` included. The identifier is no secret: it guards against mistakes, which is the whole risk, since only the owner may write the branch at all. The record is in no export slice. Rules 27 to 30 hold it (The write pipeline).

**Writes carry the link** (decision 3). A document write to a workspace's branch, a merge into it, and its deletion carry `Armature-Workspace-Link: <installation>`. Without it, or with another value, the answer is **409** `held_elsewhere` with `workspace`, `linkLabel` when the owner gave one and `linkedAt`, and never the identifier. A write to a workspace linked to no computer is **409** `not_linked` with `workspace`. The check comes after identity and authorization, since it is a conflict of state and not of authority: someone who may not write the branch is **403** whatever they send, and the owner writing from the wrong place is 409. A header that is not an identifier's shape is **400** `bad_link`. A read needs no link, a merge *from* a workspace reads it and needs none, and on a branch that is no workspace the header is ignored. A client that is not a desktop hub never sends the header.

**Moving a workspace is two steps: unlink, then link** (decision 4). Linking never takes a workspace over.

### `GET /workspaces?owner=&linked=&status=`

The records, by branch name. `owner` is `me` or a `User` id: one's own, which anyone may list. With no `owner`, or another person's, an administrator's read (**403** `forbidden`, `permission: "list_workspaces"`). `linked` is `true` or `false`; `status` is `Active` (the default) or `Closed`. `ETag` is the commit of `main` read.

### `GET /workspaces/:branch`

The `Active` record naming the branch; **404** `not_found` when the branch is not a workspace. Any resolved identity, since this is how a client tells a workspace from a branch.

### `POST /workspaces`

`{ branch, parent?, link, linkLabel? }` records a branch that already exists as a workspace linked to that installation: what the desktop app does, at its first contact after its update, for each workspace it held before workspaces were linked (decision 7). The caller holds the branch's `Owner` grant (**403** `forbidden`, `permission: "adopt_workspace"`, otherwise, a maintainer included). `parent` is `main` when absent, exists, and is no workspace (**409** `parent_is_workspace`). **201** the record; **200** when that installation already holds it; **409** `held_elsewhere` when another does; **409** `workspace_exists` when it is a workspace linked to none, which is linked instead. Until its record is written such a branch is an ordinary branch, and keeps working, unprotected.

### `POST /workspaces/:branch/link`

`{ link, linkLabel? }` links a workspace to an installation. Its owner alone (**403** `forbidden`, `permission: "link_workspace"`; an administrator may not). A workspace linked to another installation is **409** `held_elsewhere`: its owner unlinks it first. Asked again by the installation that holds it, the link stands, and a changed label is taken. Answers the record.

### `POST /workspaces/:branch/unlink`

Clears the link. Its owner, or an administrator (**403** `forbidden`, `permission: "unlink_workspace"`). It needs no link header and may be asked from anywhere: it is for a computer that is lost, broken or out of reach, as well as for the linked computer's own release once everything is pushed. The cost is the caller's to state before asking: that computer's commits not yet pushed can no longer be pushed, its next push being 409 `not_linked`. Answers `{ workspace, unlinked, was? }`: the record, whether a link was cleared, and the label and time of the link that was.

## Merge requests

On a remote hub, under `armature/merge-requests` (ADR-0072 decisions 5 and 6; since 2026-11-20). A merge request records that someone asked for one branch to be merged into another, and who decided:

```
{ "@type": "MergeRequest", "@id": "MergeRequest/<uuid>",
  "source": "<branch or workspace>", "target": "<branch>", "openedBy": "User/...", "message": "...",
  "status": "Open" | "Merged" | "Closed",
  "decidedBy"?: "User/...", "decidedAt"?: "<time>", "mergeCommit"?: "<commit>" }
```

**Which merges need one.** Every merge from a workspace, so its owner has one way to send work anywhere, and every merge into `main`, from anything, since `main` is the project's official state and a request records who asked and who decided. `POST /branches/:name/merge` refuses either made directly (409 `request_required`). Whoever may merge into the target opens a request and merges it, one call after the other. No review is asked before a merge: whoever may merge a request may merge one they opened, and a required check (Checks) can add one. Merges between branches other than `main` stay direct.

The hub writes every `MergeRequest` itself, each change a marked commit on `main` by the caller; no client writes one through the document routes, and it is read there like any document on `main`. It is infrastructure, not a design record: no note, finding or attestation can be about one, and it is in no export slice. `openedBy` and `decidedBy` are the resolved identity, the person when an agent acts for one. Rules 27 and 31 to 33 hold it.

### `POST /merge-requests`

`{ source, target, message }` opens one; **201** the record, `status: "Open"`. `message` says what it holds and why, becomes the merge commit's message, and is held to what any write's is (400 `message_required`, 400 `reserved_trailer`). Who may: whoever may write the source; for a workspace, its owner alone, a maintainer of every branch included (**403** `forbidden`, `permission: "open_request"`). Both branches exist (404 `unknown_ref`) and differ. A target that is a workspace is **409** `target_is_workspace`. A pair that already has an open request is **409** `request_open`, with `request` naming it.

### `GET /merge-requests?source=&target=&status=`

The records, filtered by any of the three; `status` is `Open`, `Merged` or `Closed`. Any resolved identity.

### `GET /merge-requests/:id`

`{ request, health? }`: the record and, while it is `Open`, what a merge would meet at both heads as they are now:

```
{ mergeable, upToDate, base, source, target, conflicts, violations, checks, bringInFirst }
```

`conflicts` and `violations` are the merge route's dry run's, `checks` and `bringInFirst` the merge gate's, and `mergeable` is true when there is something to merge and nothing in its way. `upToDate` says the target already holds the source's head. When a branch the request names is gone, `health` is `{ mergeable: false, missing: "source" | "target", ... }`. **Nothing of the health is stored** (ADR-0056): it is computed on every read, and a client learns when to read again from the event feed (Events), which reports commits on the source, on the target and on `main`, where a request's own changes are commits. Conflicts are resolved in the source: for a workspace, its owner updates from the parent, resolves what that reports and pushes, and the request is clean on the next read.

### `POST /merge-requests/:id/merge`

`{ overrides? }`, the body optional. Merges the request: the merge route's work with the request's `message`, checked before it commits and gated as any merge is (The merge gate), by whoever may merge into the target (**403** `forbidden`, `permission: "merge"`). `If-Match` pins the target's head. Every refusal of a merge comes through as that route gives it: 409 `merge_conflict`, 422 `invariant_violation`, 409 `bring_in_first`, 409 `checks_pending`, 422 `checks_failed`; the request stays `Open`. Its own: **409** `request_decided` (it is `Merged` or `Closed`; a decided request is not decided again, a new one is opened), **409** `nothing_to_merge` (the target already holds everything on the source), **409** `branch_gone`. Success: the merge's answer with `request`, now `Merged` with `decidedBy`, `decidedAt` and `mergeCommit`. The merge commit carries `Armature-Merge-Request: <id>`, and the record's change is the commit on `main` that follows it; should the hub stop between the two, merging the request again finds the commit by its trailer and records it, with no second merge.

### `POST /merge-requests/:id/close`

Closes it unmerged: `{ request }`, now `Closed` with `decidedBy` and `decidedAt`. Its opener, the owner of its source, or whoever may merge into its target (**403** `forbidden`, `permission: "close_request"`). 409 `request_decided` when it is already decided.

## Users

### `GET /users`

Every `User` at a ref (`main` by default), or with `kind=agent` the agents only and with `kind=person` the persons only (400 `bad_query` for anything else; since 2026-11-05). Under `oidc` the whole list and the persons are a maintainer's of `main` or an administrator's, **403** `forbidden` with `permission: "list_users"` otherwise, and so is the same list by `GET /documents/User`; the agents, which are tools, anyone may list (ADR-0068 decision 4, notes of 2026-10-30 and 2026-11-05). Under `header` all of it is open.

### `GET /users/me`

The `User` this request resolves to, or the resolver's 401; since 2026-11-01 with `grants`, the caller's `Grant` documents in force (ADR-0068 decision 7), so a client can hide an action it would be refused. Under `Armature-Agent` it answers the agent, who the client writes as; under a relay (Identity) the person relayed, with `relayedBy` naming the service.

### `POST /users`

Registers a user on `main`, the registry of record (ADR-0032). A `branch` or `ref` parameter is refused (400 `users_live_on_main`). The caller must be a registered user; since 2026-11-01 a person is registered by an `Administrator` and an agent by any person (**403** `forbidden`, `permission: "register"`, `agent: true | false`; ADR-0068 decision 4).

- Body: `{ "message": "...", "user": { "displayName": "...", "externalId": "...", "email"?: "...", "institution"?: "...", "issuer"?: "...", "@id"?: "User/<id>" } }`. Unknown fields: 400 `unknown_field`. `issuer` (since 2026-11-05) names the identity provider a person will sign in with under `oidc`, whose tokens resolve by `(issuer, sub)` with `externalId` the bare `sub`; a person registered ahead of their first sign-in needs it, an agent may not carry it (400 `bad_request`).
- Response **201**: `{ id, commit }`.
- An `externalId` already registered: 409 `user_exists` (with its `id`). An `@id` held by another type: 409 `type_conflict`.

AI agents are ordinary users whose `externalId` begins with `agent:` (for example `agent:coqui/item-drafter`), registered by a person. There are no routes to edit or delete a user.

---

## Grants

Authority over the graph is recorded in the graph (ADR-0068, since 2026-11-01): a `Grant` is a document on `main`, written and read through the document routes like any other, so every change of authority is a commit with an author and a reason. Its fields: `user` (the holder), `role`, `branch` (absent means every branch), `status` (`Active` or `Revoked`), `rationale`, and on a `Relay` grant `relayedUsers` and `expires`. Its identifier derives from `user`, `role` and `branch`, so there is one current grant per holder, role and branch; revoking one is a replace with `status: "Revoked"`, never a delete, and a grant past `expires` is treated as revoked. Rules 21 and 22 (The write pipeline) hold a grant to `main` and the holder's kind to the role.

| Role | What it allows |
|---|---|
| `Owner` | Written by the hub to whoever creates a branch: writing to it, merging into it, deleting it, and granting `Maintainer` on it. `main` has no owner |
| `Maintainer` | Writing to and merging into the branch named, or every branch when `branch` is absent; a maintainer of `main` is who delivers a branch into shared history |
| `Administrator` | Granting and revoking every role, and registering people. Held by persons |
| `Relay` | A service delivering a person's earlier work with the person as author, bounded by `relayedUsers` and `expires` (ADR-0067 decision 5; built 2026-11-05). Held by agents |

Who may write a grant: `Maintainer` on a branch, its owner or an administrator; anything else, an administrator (**403** `forbidden`, `permission: "grant"`). An instance's first administrator comes from the seed or the operator's `put` (ADR-0068 decision 6). A branch created before 2026-11-01, or around the API, has no owner: it stays writable, mergeable and deletable by any registered user while the migration window is open, which `GET /discover` reports as `ownerlessBranches: "writable"` under `armature/authorization`; an administrator assigns an owner by writing the grant. Grants are listed by holder, `GET /documents/Grant?user=User/<id>` (decision 8), and `GET /users/me` carries the caller's. The pseudonymous and institutional export profiles rewrite `user`, `relayedUsers`, and a handle prefix in `branch` (a workspace branch's `<handle>_`) to the person's token (ADR-0031).

---

## Check requirements

A `CheckRequirement` says which plugin's verdict a merge into a branch must carry (ADR-0070 decision 5; written through the document routes since 2026-11-13). It is a document on `main` like a `Grant`, whatever branch it binds, so every change to what a merge requires is a commit with an author and a reason. Its fields: `check` (the name the plugin owns, such as `lint/team`), `branch` (the merge target; absent means `main`), `fromPrefix` (binds only merges from branches whose name starts with it), `reporter` (the agent `User` whose runs count), `level` (`Required` or `Advisory`), `locked` (binds merges into every branch, not only `branch`), `params` (the plugin's settings, any JSON value but `null`, which the hub stores and returns without reading), `status` (`Active` or `Revoked`) and `rationale`. Its identifier derives from `check`, `branch` and `fromPrefix`, so there is one current requirement per check, target and source prefix; withdrawing one is a replace with `status: "Revoked"`, never a delete, and deleting a branch revokes the requirements naming it in the commit that revokes its grants. Rules 21 to 24 (The write pipeline) hold it to `main` and its reporter to an agent.

The requirements that apply to a merge are read with their `paramsHash` at `GET /checks/requirements` (Checks). Who may write one (**403** `forbidden`, `permission: "write_requirement"`, with `branch`, the target, and `locked`): for merges into `main`, a maintainer of `main` or of every branch; for merges into another branch, its owner or a maintainer of it or of every branch; a locked one, an administrator. The record replaced counts too: `locked` is not part of the identifier, so unlocking a requirement needs what locking it did. A branch with no owner takes a requirement only from a maintainer, migration window or not. A requirement alone in a write is judged by these rows; any other document beside it needs the right to write `main`. Requirements are listed by reporter, `GET /documents/CheckRequirement?reporter=User/<id>`; `branch` in a list query names the branch read, where no requirement lives, so a client filters `main`'s list by the `branch` field itself until `GET /checks/requirements?target=` exists. A requirement in force is enforced by the merge route (`POST /branches/:name/merge`, The merge gate; since 2026-11-15); a change to one is told by the event feed as `requirement.changed` (Events). Requirements are in the export's `full` slice (since 2026-11-15); the pseudonymous and institutional profiles rewrite `reporter`, and a handle prefix in `branch` or `fromPrefix`, to the person's token, and leave `params` as stored (ADR-0031).

---

## Checks

A plugin's verdict about one commit is a *check run* (ADR-0070 decisions 3 and 4; since 2026-11-13), kept by the hub in memory outside the design graph, on both roles: a plugin on a person's machine posts to the workspace hub on loopback as one more tool there. The hub hosts checks and never rules: it knows a check by its name, by the agent whose runs count and by the verdicts posted; it never reads a requirement's `params`, evaluates a design rule or calls a plugin (decision 1). Runs are bounded to the newest 50 per check and branch, and gone after a restart. The capability is `armature/checks`, with `runsKept` and `conclusions` among its settings. A plugin learns what to check from the event feed (Events, since 2026-11-15), and the merge route counts its runs toward the requirements that apply (`POST /branches/:name/merge`, The merge gate; since 2026-11-15). On a workspace hub, where nothing is merged, a person's own requirements gate their push instead (`POST /workspace/:name/push`, The push gate; since 2026-11-15).

### `POST /checks/runs`

Body: `{ "check": "lint/team", "commit": "<commit-id>", "branch": "<name>", "conclusion": "pass" | "fail" | "neutral" | "error", "summary"?: "...", "counts"?: { "<key>": <integer> }, "paramsHash"?: "sha256:<hex>", "detailsUrl"?: "https://..." }`. No `message`: a run is not a write to the graph and makes no commit. The hub adds `reporter`, the request's author (the agent under `Armature-Agent`, else the caller), `reportedAt` and an `id`, and answers **201** with the run. Anyone who may read the branch may post a run about it, a service under its own credential included (ADR-0067 decision 10 is not engaged; decision 4); a relay may not. Whether a run counts toward a requirement is the merge gate's comparison of its `reporter` and `paramsHash` with the requirement's, never a refusal here: a run by anyone else is advisory. `paramsHash` is copied from `GET /checks/requirements`. Errors: **400** `invalid_run` with `issues` (`{ path, message }`, every problem at once; an unknown field among them); **404** `unknown_ref` for a branch or a commit the hub lacks; on a workspace hub **403** `forbidden` with `owner` for anyone but the workspace's owner.

### `GET /checks?commit=&branch=&check=`

The runs held, newest first, each `{ id, check, commit, branch, conclusion, summary?, counts?, paramsHash?, detailsUrl?, reporter, reportedAt }`; any of the three filters, or none. No `ETag`: runs are not read from a commit.

### `GET /checks/requirements?target=&from=`

The `CheckRequirement`s in force on `main` that apply to a merge into `target` (`main` when absent) from `from`: those naming the target, those `locked`, filtered by `fromPrefix` against the source when one is given, every prefix kept when none is (decision 5). Response `{ target, from?, requirements: [ { ...the record, paramsHash } ] }`, `ETag` the commit of `main` read. `paramsHash` is `sha256:` and the hex SHA-256 of `params` in a canonical form (keys sorted at every depth, no whitespace, numbers as JSON prints them), computed by the hub over the value as the store returns it, since the store reorders a JSON value's keys and prints `1.0` as `1`: a plugin copies it into its runs rather than hashing the text it sent. Layering several requirements' `params` is the plugin's. On a workspace hub `main` is the mirror, which holds the remote's requirements as of the clone or the last push or delivery (decision 8; since 2026-11-15): shown there, enforced by the remote alone. A workspace hub's answer also carries `personal`, the owner's own requirements in force that gate a push of `target` (`POST /workspace/:name/push`, The push gate), each `{ check, branch?, fromPrefix?, level, params, status, rationale?, paramsHash }`; **422** `personal_checks_invalid` when `checks.json` cannot be read as requirements. 400 `bad_query` for a `target` or `from` that is not a branch name.

---

## Events

What changed on this hub since a client last asked, pulled by the client (ADR-0070 decision 2; since 2026-11-15), on both roles. The hub calls nothing outside itself, so there are no webhooks: a tool that reacts to changes, a check service above all, asks the feed, holds the answer's cursor and asks again. The hub keeps no event log. Every event but `hub.started` is a commit the store holds or a branch appearing in or vanishing from its list, derived on each request from the branches' logs, so the feed survives a restart and has nothing to back up. The capability is `armature/checks`; its settings `events`, `eventsPage`, `eventsWait` and `eventsBacklog` are the types served and the three bounds below.

### `GET /events?since=<cursor>&types=&branch=&wait=&limit=`

Response `{ events: [ ... ], cursor }`. No `ETag`: the feed reads at no one commit. Any identity that may read may read it.

**The cursor** is opaque text the hub gives and the client passes back as given. It records, for every branch, the commit the client has been told about up to, so it survives a restart of the hub and needs no clock. With no `since` the answer is at once: no events and a cursor at the present. With one, the answer is what changed since, oldest first, at most `limit` events (100, the default and the most), and the cursor after them; a client further behind asks again until an answer is empty. Every answer carries a cursor, also an empty one. A cursor the hub cannot read is **400** `bad_cursor`; one more than 1,000 commits behind on a branch is **400** `cursor_too_old` with `branch`, and the client starts again without `since` and reads what it missed from `GET /branches/:name/log`.

**The wait.** When nothing has changed, the request is held open up to `wait` seconds (30, the default and the most; `0` answers at once) and returns as soon as a commit is made through this hub, or at its time with no events (long-poll). A commit made by another hub on the same store, or by the operator tools, wakes no one and is told at the next request. A client sets its own timeout above `wait`, and a proxy in front of the hub must allow a response that takes 30 seconds.

**The events.**

| `type` | Told when | Fields |
|---|---|---|
| `commit` | A commit landed on a branch | `branch`, `commit`, `parent`, `author`, `timestamp`, `changed`, `workspaceCommit`? |
| `merge` | A merge landed on a branch (`POST /branches/:name/merge`) | as `commit`, with `mergeSource`, the source commit merged |
| `branch.created` | A branch is listed that the cursor lacks | `branch`, `commit`: the commit it started from, absent when it started from nothing |
| `branch.deleted` | A branch the cursor holds is gone | `branch`, `commit`: the last commit of it this client was told about |
| `requirement.changed` | A commit on `main` wrote or deleted a `CheckRequirement` | `branch` (`main`), `commit`, `requirements`: the records' ids |
| `hub.started` | The cursor was given by an earlier life of the hub | `startedAt` |

An event names what a tool needs to decide whether to act, never the documents: `changed` is the count of documents the commit changed by class (`{ "AssessmentItem": 2, "ItemInstance": 1 }`, absent on a branch's first commit), and the documents themselves are read through `GET /branches/:name/changes`, `/log` and `/export`. `author` is the commit's, as the log gives it; the feed takes no filter on an author (ADR-0021; decision 11). `workspaceCommit` is present when the commit is a push's replay, naming the workspace hub's commit. `requirement.changed` follows the `commit` event of the same commit. `hub.started` comes first in its answer and means the hub's check runs, held in memory, are gone: a check service reports again on the heads it cares about. A branch creation on a remote hub is also a `commit` on `main`, its `Owner` grant, and the branch starts from that commit.

**The order.** Within a branch, events follow its log. Across branches they follow the commits' timestamps, which is advisory: a workspace hub's store stamps to the millisecond. `branch.created` events come before the commits of an answer and `branch.deleted` after them.

**The filters.** `types` is a comma-separated list of the types wanted (an unknown one is **400** `bad_query`); `branch` keeps one branch's events, with `requirement.changed` and `hub.started`, which concern every branch. The cursor moves past what a filter leaves out, and a held request is not ended by an event the caller filtered out.

**What the feed leaves out.** The transient branches of a merge's check and of an operator's repair, and on a workspace hub the snapshots of the remote, are never told. The commits written to a branch between a client's last request and that branch's deletion are not told, and so nothing is told of a branch made and deleted between two requests: a deleted branch's log is gone, its commits stay held by the branch that merged it, and that branch's `merge` event names the source commit. A tool that follows the feed is woken by each commit and misses none of it.

---

## Design intelligence

All seven reads compute their answers from the graph at the requested ref; nothing they report is stored (ADR-0056). Each accepts `?branch=` or `?ref=` and returns the commit in `ETag`.

### `GET /intelligence/coverage/:moduleId`

How well the module's assessments cover each objective it declares (ADR-0029 decisions 1 to 3, ADR-0019). `:moduleId` is the local part (`how-ai-works`).

| Query parameter | Meaning | Default |
|---|---|---|
| `fullyAssessedAt` | Distinct eligible items at which a declaration is `FullyAssessed` (at least 1) | 2 |
| `overAssessedAbove` | Distinct eligible items above which it is `OverAssessed` (at least `fullyAssessedAt`) | 4 |

An incoherent pair is a 400 `bad_query`.

Response:

```
{
  module:     { id, type, label, ... },
  thresholds: { fullyAssessedAt, overAssessedAbove },
  summary:    { declared, coverage: { <verdict>: n }, projected: { <verdict>: n }, undeclared },
  objectives: [
    { id, role, sequence, roleRationale, objective: { id, label, bloomsLevel, ... },
      coverage:  { status, items },     // Approved items in Approved placements
      projected: { status, items },     // every item and placement not Retired
      assessedBy: [ { id, label, status, eligibility: "delivered" | "projected" | "none",
                      placements: [ { id, assessment, status } ] } ] }
  ],
  undeclared: [ { objective, assessedBy } ]   // assessed by the module's items but never declared
}
```

Verdicts are `Uncovered` (0 eligible items), `PartiallyAssessed` (below `fullyAssessedAt`), `FullyAssessed`, and `OverAssessed` (above `overAssessedAbove`). Only items placed in the module's own assessments count, and each distinct item counts once however many times it is placed.

### `GET /intelligence/coverage?course=<courseId>`

The same block for every module of a course (`{ course, thresholds, modules: [ ... ] }`), modules in sequence order. Without `course=` it returns every module in the database.

### `GET /intelligence/alignment?module=<moduleId>`

Bloom's-level alignment for a module's declared objectives, or for every objective when `module` is omitted.

Response: `{ scope, itemsBelowObjective: [ { item, objective, levelsBelow } ], objectivesWithoutItemAtLevel, objectivesWithoutActivity, itemsWithoutObjective, unleveled: { objectives, items } }`. An item counts as reaching its objective when its level is the same or higher. Activities have no Bloom's level, so "without activity" means no activity targets the objective at all. `itemsWithoutObjective` lists items that assess nothing (ADR-0060): every such item in the bank, or, with `module`, those placed in the module's assessments; they are in no objective's scope, so `scope.items` does not count them.

### `GET /intelligence/trace/:type/:id`

Walks the design lifecycle in both directions from one document:

```
evidence ← need-evidence link → need ← objective ← item ← placement → assessment ← dataset ← metric
                                                 item ← formative use → activity
```

with an item's formative uses (`ActivityItemLink`, ADR-0061) followed downstream to the activities that use it, and modules attached as context to every objective (through its declarations), assessment and activity (through its module links, its own or, for an activity in a lesson, the lesson's) reached, and a metric's `subject`, the record it measures, followed in both directions (an item statistic leads to its item, and an item to the metrics about it; ADR-0058). Accepted types: `LearningMetric`, `LearningDataset`, `Assessment`, `AssessmentItem`, `LearningObjective`, `LearningNeed`, `DescriptiveEvidence`, `Module`, `LearningActivity`. Any other type is a 400 `untraceable_type`.

Response: `{ root, nodes: [ summary ], edges: [ { from, to, via, through?, confidence?, status?, role? } ], annotations: [ design notes, findings and attestations about any node reached ] }`. A note or finding about one part carries its `fragmentId`; an attestation is reported as by the attestations read below, with its `state`. `via` is the field followed; `through` is the junction document passed through, with its data. A dataset, metric or finding summary carries its `asOf`: read the rest of the design as that cohort met it, or as that finding judged it, at `?ref=<asOf>`.

### `GET /intelligence/attestations/:type/:id`

The attestations whose `subject` is this record, each with whether the part it judged has changed since its `asOf` (ADR-0028 decision 7). Whether an attestation still holds is computed here, never stored.

Response:

```
{
  subject:  { id, type, label, ... },
  summary:  { attestations, byState: { Current, Stale, FragmentRemoved, Unanchored } },
  attestations: [
    { id, type, subject, fragmentId?, claimRef?, claimText?, verdict, reason?, asOf?, attestedBy,
      state: "Current" | "Stale" | "FragmentRemoved" | "Unanchored" } ]
}
```

The judged part is the fragment named by `fragmentId`, or the whole record when there is none. It is read at `asOf` and at the requested ref and compared with every nested `@id` removed and fragments matched by `fragmentId`, so reordering an item's options changes no fragment (it does change the whole item). `Stale`: the part differs. `FragmentRemoved`: the record no longer has the part. `Unanchored`: no `asOf`, or the subject is not at it. A stale verdict is still a true record of what its attester affirmed then. The comparison works after a merge, when the commit attested is on another branch. The read takes no attester parameter and reports no count per person (ADR-0021).


### `GET /intelligence/item-statistics`

The item statistics in the bank, or with `?module=` (`Module/<id>` or the bare id) in the module's assessments: each item with every `LearningMetric` whose `subject` is that item (ADR-0058), newest administration first (the dataset's `administrationDate`, then the metric's `collectedAt`). Nothing is summarized: which figure counts as an item's difficulty (the latest administration, one cohort, the spread across cohorts) is the client's choice, and the response carries what it needs to choose. `?unit=` keeps the metrics in one unit (free text, matched exactly); `units` lists every unit in scope before that filter. A metric with no `subject`, or one about something other than an item in scope, is not reported here.

Response:

```
{
  scope: { module?: { id, type, label }, items, metrics },
  units: [ "proportion correct", ... ],
  items: [
    { item: { id, type, label, bloomsLevel, status },
      statistics: [
        { metric:  { id, type, label, value, unit, asOf },
          collectedAt?,
          dataset?: { id, type, label, asOf, cohort?, administrationDate? } } ] } ],
  itemsWithoutStatistics: [ { id, type, label, ... } ]
}
```

Errors: 404 `not_found` for an unknown module.

### `GET /intelligence/module-content/:moduleId`

A module's content in teaching order, the composed view ADR-0005 assigns the API. The module's `ModuleActivityLink`s and `ModuleLessonLink`s are merged by `sequence` (one namespace, constraint 3); each lesson's activities follow in their `LessonActivityLink` order (constraint 4); each activity carries the items it uses formatively in their `ActivityItemLink` order (ADR-0061, constraint 17). The three sequences are never combined. Every `sequence` is optional in the schema: an entry without one follows those with one, ordered by link id, and carries no `sequence`. `:moduleId` is the bare id (`how-ai-works`), as for coverage.

The view is a tree of placements, not a set of activities. The keys allow one activity both standalone and inside a lesson of the same module, or in two of its lessons; it appears at each place, each time with the `link` that put it there (a `ModuleActivityLink` or a `LessonActivityLink`), and `repeated` names it with every placement. Nothing calls that an error. A module's assessments are not content in this sense: read them through coverage.

Response:

```
{
  module:  { id, type, label },
  summary: { entries, lessons, activities, placements, formativeUses, unsequenced },
  content: [
    { kind: "activity", sequence?, link,
      activity: { id, type, label, activityType?, targets: [ "<objective id>", ... ] },
      items: [ { sequence?, link, item: { id, type, label, bloomsLevel, status } } ] },
    { kind: "lesson", sequence?, link, lesson: { id, type, label },
      members: [ { sequence?, link, activity, items } ] } ],
  repeated: [ { activity: { id, type, label }, placements: [ "<link id>", ... ] } ]
}
```

`activities` counts distinct activities and `placements` every place one appears; `unsequenced` counts links at any level without a `sequence`. Formative uses count toward no coverage. Errors: 404 `not_found` for an unknown module.

### `GET /intelligence/impact/:type/:id`

Every document that references this one, found from the schema's reference fields: `{ document, summary: { references, byType }, references: [ { id, type, label, field, within? } ] }`. For a junction, `within` names what it sits in (the assessment a placement belongs to, the module a declaration is for).

---

## Export

### `GET /export?branch=|ref=&profile=<full|pseudonymous|institutional>&slice=<name>`

The graph at a ref as one JSON-LD document (ADR-0031): `{ "@context", "armature": { ref, profile, slice, pseudonyms, users, counts: { documents, byType }, unresolved }, "schema", "documents" }`. `documents` are the store's native shape, unchanged; `schema` is the schema graph at the same ref as it can be reloaded (the store's `@max_cardinality: "inf"` decoration removed, platform check AE5); the `ETag` is the commit exported and `armature.ref` repeats it. Defaults: `profile=full`, `slice=full`. Under `oidc` (since 2026-11-05) the default profile is `pseudonymous`, and `profile=full` carries every `User` only for a maintainer of `main` or an administrator: anyone else, a service's credential included, gets the `User` documents the exported records name (and their own, and every agent), `armature.users: "referenced"` rather than `"all"`, since those authors are readable one by one already and the registry of everyone registered is what the user list keeps (ADR-0068 decision 4, notes of 2026-10-30 and 2026-11-05). A workspace hub's clone, snapshots and forwarded reads take `full` this way. Under `header` `armature.users` is always `"all"`.

Profiles rewrite people only. `full` keeps `User` documents as stored. `pseudonymous` replaces every `User` by `{ "@id": "User/<token>", "@type": "User", "externalId": "<token>" }` and rewrites every reference to a user (`createdBy`, `attestedBy`, any field whose target is `User`) to the token's id; nothing else about the person is kept. `institutional` adds `institution` to that. The token is an HMAC-SHA256 of the `User` id under `ARMATURE_EXPORT_KEY`; with the key set, `pseudonyms` is `stable` and the same person has the same token in every export of the deployment; without it a key is minted per export and `pseudonyms` is `per-export`. A `Grant` and a `CheckRequirement` name a branch (`branch`, and a requirement's `fromPrefix`), and a workspace branch begins with its owner's handle (`<handle>_<name>`, Workspace), so those names are rewritten too: the handle becomes the owner's token. Whose the branch is comes from the `Owner` grant that names it (since 2026-11-16; ADR-0031, note of that day), not from matching the name's beginning against today's handles, which left an email's local part in the clear once the email was corrected and gave one person's branch another's token when two emails shared a local part. A name with a `_` whose beginning is no handle its owner has now keeps none of itself, `<token>_<16 hexadecimal digits>`; one with no owner on record is rewritten by the handle of exactly one person, and is `branch-<16 hexadecimal digits>` otherwise; a name without a `_` is no workspace's and stays. The same key gives the same names. Free text is not scrubbed.

A slice is a named list of classes (`GET /export/slices`); a document is included when its type is one of them or inherits one. `unresolved` lists every reference from an included document to one that is not included (`{ id, field, target }`); nothing is dropped from a document. The `full` slice (every design record, `User`, `Grant` and, since 2026-11-15, `CheckRequirement`) has none and is the only one that reproduces the graph when re-imported.

There is no import route. Re-import is an operator action outside this API (ADR-0062): load `schema` into an empty database or branch, then post `documents` in one request. Errors: 400 `unknown_profile`, `unknown_slice`; 404 `unknown_ref`.

### `GET /export/slices`

The slice configuration: `{ "<name>": { description, classes } }`.

---

## Discovery

### `GET /discover`

What this hub is, for a client that wants to know before its first write (ADR-0059 decision 6). No ref, no identity; the same at every ref. Response:

```
{
  role:         "remote",                                  // or "workspace" (since 2026-11-01)
  versions:     [ "2026-11-06", "2026-11-05", ... ],       // the revisions served, newest first
  identity:     { resolver: "header",                      // or "oidc" (since 2026-11-05)
                  headers: { "Armature-User": "person", "Armature-Agent": "agent" } },
                                                           // under oidc: headers { Authorization: "bearer", "Armature-Agent": "agent",
                                                           //   "Armature-User": "relay" }, issuer, audience, clientId
  instance:     { name: "Armature at Example University",  // since 2026-11-06; on a workspace hub, its remote's
                  api: "https://api.armature.example.edu", // absent on a hub with no public name
                  program: { releases: "https://github.com/mossglenn/armature/releases" } },
  capabilities: { "armature/documents": { fallback: "reject", batchLimit: 500, historyCount: 20, readOnlyBranches: [] },
                  "armature/branches": { fallback: "reject", logCount: 20, logPage: 100, workspaces: "linked", remoteOnly: [] },   // workspaces, since 2026-11-20
                  "armature/merge-requests": { fallback: "reject", required: ["from a workspace", "into main"] },                // a remote hub's, since 2026-11-20
                  "armature/checks": { fallback: "reject", runsKept: 50, conclusions: ["pass", "fail", "neutral", "error"],  // since 2026-11-13
                                      events: ["commit", "merge", "branch.created", "branch.deleted", "requirement.changed", "hub.started"],
                                      eventsPage: 100, eventsWait: 30, eventsBacklog: 1000,                 // the feed, since 2026-11-15
                                      gate: ["merge"] },                                                    // what the required checks gate here: ["push"] on a workspace hub
                  "armature/intelligence.coverage": { fallback: "reject", fullyAssessedAt: 2, overAssessedAbove: 4 },
                  ... },                                   // each with its fallback and its settings
  schema:       { route: "/api/v1/schema" }
}
```

`identity` says how to authenticate (ADR-0067 decision 9, since 2026-11-05): the resolver, the headers a client may send with what each names (`person`, the caller; `agent`, a registered agent acting for the caller; `bearer`, the token; `relay`, a service naming the person whose earlier work it delivers under a `Relay` grant), and under `oidc` the `issuer` and `audience` a token is checked against and, when the instance set one, the `clientId` a native program signs in with (`ARMATURE_OIDC_CLIENT_ID`). The admission list is not published.

`instance` is the connection profile (since 2026-11-06; [desktop program plan](desktop-program-plan.md) §8): what a person confirms before connecting, read before any sign-in, so it holds no secret. `name` is `ARMATURE_INSTANCE_NAME`, else the host of the hub's public address, else the host the request called it by. `api` is where a client beyond the server reaches the hub, `ARMATURE_PUBLIC_URL`, read only under `oidc`: a hub under `header` is never published, so it has none and a client keeps the address it was given. `program.releases` is where the desktop program comes from. A workspace hub repeats its remote's entry as the newest clone from that remote kept it (the workspace record's `instance`), so a tool on the machine learns the instance's name offline; before its first clone, or when the remote published none, the entry is absent, as it is on a hub older than this revision.

A capability's `fallback` says what a hub that lacks it does with a request that declares it: `reject` (refuse by name) or `ignore` (serve under core behavior). Every capability the hub defines is `reject`. The settings are the defaults of the behavior's parameters, so a client can read them rather than assume them.

A workspace hub also lists `armature/workspace` (Workspace), with its settings `profile`, the export profile a clone takes, `localToken: required` (every write carries the hub's secret for its tools; Identity) and `actions`, `routes` when push, bring in, deliver and remove are served as routes on this hub or `program` when they are the desktop program's own and the routes are refused (both since 2026-11-03); a remote hub neither lists nor accepts it. A remote hub lists `armature/authorization` (Grants; since 2026-11-01): the hub authorizes, a **403** `forbidden` is possible, `GET /users/me` carries grants, and its one setting, `ownerlessBranches`, says whether a branch with no owner is still `writable`; a workspace hub, which does not authorize, lists it not.

Since 2026-11-20 (ADR-0072) a remote hub lists `armature/merge-requests`, whose `required` names the merges the merge route refuses outside a request, and `armature/branches` covers `/workspaces` and says `workspaces: "linked"`: a workspace's branch is written only with its link. A workspace hub's `armature/workspace` gains `link: "installation"` (its workspaces are linked to this hub's installation) and `delivery: "merge-request"` (work leaves a workspace by one); it answers every route under `/workspaces` and `/merge-requests` **400** `remote_only`, the first group listed in `armature/branches`'s `remoteOnly`.

`role` is what kind of hub this is (ADR-0065; [workspace hub plan](workspace-hub-plan.md) §9). A **remote** hub is a hub as built. A **workspace** hub, `ARMATURE_ROLE=workspace` with the remote's address in `ARMATURE_REMOTE_URL`, is the same API on one person's machine; what changes the remote's shared state happens on the remote, so it refuses those routes with **400** `remote_only`, and they are listed under their capability's `remoteOnly` as `METHOD /api/v1/path`: `POST /branches`, `POST /branches/:name/merge` and `DELETE /branches/:name` under `armature/branches`, `POST /users` under `armature/users`. Its `main` is the remote's, mirrored, and listed in `armature/documents`'s `readOnlyBranches`: read as on any hub, a write to it is `remote_only`. It registers no one: an identity its mirror does not hold is **401** `unknown_user`, to be registered on the remote. On a remote hub both lists are empty.

### `GET /schema?branch=|ref=`

The schema graph at a ref (ADR-0027 decision 4), so a tool discovers types, categories and fields from the hub rather than from a copy of `schema.json`: `{ ref, schema: [ { "@type": "@context", ... }, { "@id": "LearningObjective", "@type": "Class", ... }, ... ] }`, with the commit in `ETag`. The entries are in the form the export carries and the store reloads (the store's own `@max_cardinality: "inf"` decoration removed; ADR-0031). Every class carries `@metadata.armature.category`.

---

### `GET /health/live` and `GET /health/ready`

Two probes for whatever watches a hub (since 2026-11-05; ADR-0067 decision 7, note): `live` answers `{ live: true }` whenever the process does, with no store; `ready` answers `{ ready: true }` when the registry branch's head can be read, else **503** `not_ready` with `Retry-After`; either answer is kept for two seconds (since 2026-11-16), so the probe, which needs no token, reads the store at most that often however often it is asked. Both are open without a token under `oidc`, as `GET /discover` is, since a probe cannot sign in, and say nothing about the graph. The hub's container image uses `live` as its health check.

---

## Workspace

Served by a workspace hub only (ADR-0065; [workspace hub plan](workspace-hub-plan.md) §4), under `armature/workspace`, which only such a hub lists in `GET /discover` and accepts in `Armature-Capabilities`. A remote hub answers these routes with **400** `workspace_only`. Since 2026-11-01. The workspace hub calls its remote (`ARMATURE_REMOTE_URL`) as an ordinary client of `/api/v1`, acting as the caller; a refusal from the remote comes back with the remote's own status and code and `remote: true`, and a remote that cannot be reached is **502** `remote_unreachable`. A remote under `oidc` is called with the owner's bearer token, which the workspace hub's host supplies (`ARMATURE_REMOTE_TOKEN` for the hub's process; ADR-0067 decision 2, note of 2026-11-05), and no `Armature-User`; before a workspace is made, pushed, brought in or delivered the remote's `GET /users/me` must resolve that token to the owner, else **403** `forbidden` with `reason: remote_identity`, `owner` and `credential`.

**Since 2026-11-20 (ADR-0072)** a workspace is linked to this hub's *installation*, an identifier its host draws once and keeps (the desktop app in its settings; `app/server.ts` from `ARMATURE_INSTALLATION`, else in the folder as `installation.json`), which the hub sends to its remote on every call as `Armature-Workspace-Link`; its work leaves by a merge request into its *parent*, the branch it was created from, where it used to be delivered into `main`; and `POST /workspace` no longer clones a branch that is not the owner's own workspace. The sections below say so where each applies; `deliver` in the next paragraphs is the history.

Push, bring in and deliver (since 2026-11-01, later the same day) are the rest of the cycle, each through that same client (ADR-0065 decisions 5 and 6 with their notes; plan §4 to §6). They are the owner's actions: the desktop program's own when it exists (ADR-0065 decision 7, note), and until then the routes below, served only on a hub started with `ARMATURE_WORKSPACE_ACTIONS=routes` (the `workspace` compose profile does); elsewhere each is **403** `forbidden` with `reason: program_action` and `permission` naming the action, before the workspace is looked up, and `GET /discover` says `actions: program` (since 2026-11-03; until then the routes were open to any process on loopback). Like every write to a workspace hub, each carries `Armature-Local-Token` (Identity). On a workspace hub a workspace is written, pushed, brought up to date and delivered by its owner, or by an agent acting for its owner; a request as anyone else is **403** `forbidden` with `owner` and `permission` naming the action (plan §7).

A workspace's record: `{ branch, remote, owner, ownerExternalId, from?, base, local, clonedAt, instance?, link? }` (`from` is the workspace's parent, `main` when absent on a record older than 2026-11-20; `link` is the installation the remote links it to, this hub's, absent on a workspace held from before until the hub has recorded it on the remote): the branch (the same name on the remote and here), the remote's address, the owner's `User` id on the remote and external identifier, the remote branch it started from when this hub created it, the remote commit cloned (the *base*), the local commit holding the clone, and when. Records are kept in the folder `ARMATURE_WORKSPACE_DIR` names, outside the store; beside each record, after its first push, `push.json`, the push table (below), and since 2026-11-02 `snapshots.json` and `log.json` (next).

**What the clone holds, and remote commit identifiers** (since 2026-11-02; plan §8, §16 question 3; ADR-0065 decision 5, note). A clone is the branch's export at the base, and beyond it the remote's state at each older commit a cloned or brought-in record names in `asOf` (a *snapshot*: the remote's full export at that commit, loaded into a branch of this hub's store named `at.<commit>`, left out of `GET /branches` and refusing writes with **400** `remote_only`), taken most-referenced first within a budget of commits per workspace (`ARMATURE_SNAPSHOTS`, 20 by default), and the remote branch's log back to its beginning. On a workspace hub a remote commit identifier then works wherever a commit works: `?ref=` naming the base, a pushed or brought-in commit, or a held snapshot is served here, with `ETag` the identifier asked for; `If-Match` may name the remote identifier of the head's counterpart; `GET /branches/:name/log` on a workspace continues past the clone's own commits with the remote's entries from the base back. A read at a commit this hub does not hold is forwarded to the remote when it can be reached, read-only and as the caller (the state at that commit is read once as the remote's export and the read runs here over it, so the answer is the one the remote gives), and is **404** `unknown_ref` with `remote_needed: true` and `remote` when it cannot. A write whose `asOf` names such a commit is checked the same way online, and offline is **422** `unknown_commit`. So constraints 13 and 16 and the attestation staleness read work offline for everything the snapshots cover.

### `GET /workspace`

The workspaces this hub holds, their records, by branch name.

### `POST /workspace`

Needs an identity, which the remote resolves (an identity it does not know is its **401** `unknown_user`, with `remote: true`). Body, one of:

- `{ name, from? }`: creates the branch `<handle>_<name>` on the remote from the branch `from` (`main` by default), then clones it. `<handle>` is the local part of the caller's email as the remote records it, or of their external identifier when the record has no email (since 2026-11-08; before, always the external identifier, which under `oidc` is the provider's `sub`), in the characters a branch name allows: a label taken when the branch is created, not ownership (ADR-0068; ADR-0065, note of 2026-11-08). The branch name must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$`, else **400** `bad_name`.
- `{ link }` (since 2026-11-20; ADR-0072 decision 4): links one of the caller's workspaces that is linked to no computer to this installation (`POST /workspaces/:branch/link` on the remote), then clones it; its record's `from` is the parent the remote's record names. A workspace linked to another computer is the remote's **409** `held_elsewhere`, a branch that is no workspace its **404** `not_found`, someone else's workspace its **403**. A link whose clone did not finish is completed by asking again. A name this hub's own folder and store use is **400** `bad_name` with `reserved: true`, before the remote is asked (since 2026-11-16): `main`, which is the hub's mirror of the remote's; a name shaped `at.<commit>`, which holds the remote's state at a commit here; and `lock`, `store.json`, `checks.json` and `installation.json`, files of the hub's folder. Until 2026-11-20 this was `{ existing }`, which cloned any branch the remote had, with a `warning` when the caller might not write it; it is now **400**, since a colleague's branch is read on the instance.

With `{ name }` the branch is created on the remote as a workspace linked to this installation (`POST /branches` with `workspace`), and `from` naming a workspace is the remote's **409** `parent_is_workspace`.

Both first mirror the remote's `main` into this hub's `main` (its schema, the owner's own `User` from `GET /users/me` and every agent from `GET /users?kind=agent`, read at one remote commit; nothing is written when nothing changed; until 2026-11-05 every `User`, which under `oidc` is a maintainer's read), then load the branch's export at its head, `full` profile and the whole graph, into a local branch of the same name, its schema in one commit and its documents in a second. A local branch of that name with no record is an interrupted clone and is replaced when it holds only a clone's own commits; one with other work is **409** `branch_exists`. The base is the export's `ETag`, which must be a bare commit identifier: one a proxy in front of the remote has altered (a compressing proxy appends the encoding's name, `"<commit>-gzip"`) is **502** `remote_error` with `reason: etag_altered` and `commit`, before anything is written, since such a base would be refused at every push (since 2026-11-05; found on the Droplet, [deployment](deployment.md), "An instance under `oidc`"). A workspace this hub already holds is **409** `workspace_exists`. Answers **201** with the record and `snapshots`, the snapshot records (`{ commit, references, held, documents?, fetchedAt?, reason? }`; `reason` is `budget` or the remote's refusal code). For `{ existing }` the hub first asks the remote whether the caller may write the branch (their grants from `GET /users/me`, the branch's `Grant` documents, judged by the remote's own rule) and, when not, adds `warning: { code: "forbidden", message, holders }` to the record it answers, `holders` the `User` ids holding `Owner` or `Maintainer` of the branch on the remote; the workspace is made either way, to read, to work in while asking for a grant, or to carry its content elsewhere (ADR-0068 decision 9; since 2026-11-01). A workspace this hub created is the caller's own, so it carries none. The warning is not stored. If the remote branch was created and the clone then failed, retry with `{ existing }`.

### `GET /workspace/:name/status`

Since 2026-11-20 `remote` also carries `link`, where the remote says the workspace is linked: `here`; `elsewhere`, with that computer's `linkLabel` and `linkedAt`; `unlinked`; or `none`, for a workspace held from before and not yet recorded on the remote. `elsewhere` and `unlinked` mean this computer's push will be refused.

`{ workspace, head, localCommits, pushed, unpushed, snapshots, remote }`: the record, the local head, the number of local commits since the clone and how many of them are pushed, the snapshots (`{ budget, held: [commit], declined: [record] }`), and the remote branch's head with `moved` (whether it differs from the last commit this hub pushed, the base before any push), or `{ reachable: false }` when the remote cannot be reached, with `reason: "signed_out"` or `"issuer_unreachable"` when it was not asked for want of a credential (since 2026-11-15: under `oidc` a person signed out, or offline of the identity provider, used to get the token source's 401 or 503 for the whole status, though everything else in it is known on the machine), or `reason: "other_remote"` when the workspace was cloned from another remote than this hub's (since 2026-11-16; "A workspace of another remote", below). **404** `not_found` for a workspace this hub does not hold.

### `POST /workspace/:name/push`

Replays every local commit since the clone that is not yet on the remote, oldest first, each as one `POST /documents` on the remote with `If-Match` naming the remote commit the previous replay produced (the base for the first), as the owner, or as the agent acting for the owner when an agent made the commit here (`Armature-Agent`, so the remote records the agent as author and writes `Armature-On-Behalf-Of` itself). Needs an identity: the workspace's owner, or an agent acting for them (**403** `forbidden`, `permission: "push"`, otherwise). The documents are the commit's own, read at that commit, with the store's nested ids left out and every `asOf` that names a local commit rewritten to the remote commit it became, exactly, since the workspace has one writer and replay starts from the base; a `User` copy the local pipeline carried onto the branch is left out, since the remote carries its own. The message is the local one, the hub's own trailers removed (the remote writes them again) and these appended, the pusher's claims, which the remote keeps as sent (ADR-0065 decision 5):

```
Armature-Workspace-Commit: <local commit id>
Armature-Authored-At: <ISO 8601 time of the local commit>
Armature-Workspace-Part: <n>/<total>         only when the commit was split
```

A local commit larger than one request (500 documents, 10 MiB) is replayed as several, each an ordinary write the remote checks: its documents are ordered so that each follows what it names, documents that name each other stay in one request, and a group no request can hold is **422** `group_too_large` with `documents` (the split rule, ADR-0065 decision 5, note of 2026-10-30; platform check AL found the store takes the hub's cap with room to spare, so the cap is the hub's). The commit table, `push.json` beside `workspace.json`, maps each local commit to the remote commit it became: `{ commits: [ { local, remote, parts, pushedAt } ], inFlight?, bringingIn? }`. The in-flight marker is written before each request, so a push interrupted after the remote accepted one (a dropped connection, a crash) is settled by the next push from the remote branch's log (`GET /branches/:name/log`), which carries the trailers above when it landed: landed is recorded, not landed is sent again, once (ADR-0066 decision 2, note). A bring-in that did not finish leaves its own marker, `bringingIn`, which a push settles before it replays anything (the bring-in below says how); where a local commit made since changed a document that merge changed, the push is **409** `unpushed_commits` with `overlapping`, as the bring-in is.

**The push gate** (ADR-0070 decision 8; since 2026-11-15). A person may ask checks of their own pushes, as *personal requirements* in `checks.json` at the root of the hub's folder: `{ "requirements": [ { "check": "lint/mine", "params": { ... }, "branch"?: "<workspace>", "fromPrefix"?: "...", "level"?: "Required" | "Advisory", "status"?: "Active" | "Revoked", "rationale"?: "..." } ] }`, a `CheckRequirement`'s shape without `reporter`. `branch` names the workspace a requirement binds and `fromPrefix` the beginning of the names it binds; with neither it binds every workspace; `level` is `Required` and `status` `Active` when absent. The host writes the file (the desktop program's Settings page, through its core, or the person by hand) and no route does, so a tool with the pairing key cannot relax its owner's gate. Before anything is replayed, and before the remote is asked anything, each `Required` one in force is held to the workspace's head against the runs this hub holds: a run with the requirement's current `paramsHash` must exist there (**409** `checks_pending` with `pending`) and conclude `pass` or `neutral` (**422** `checks_failed` with `failed`), each with `commit`, the head, and `checks`, the verdicts as the merge gate gives them, without `reporter`: every tool on the machine acts as the owner, so any run there counts. Nothing is pushed. A plugin reads what to run, and the hash to run under, from `GET /checks/requirements?target=<workspace>` (`personal`). Body, optional: `{ "overrides": [ { "check", "reason" } ] }` sets a requirement aside (**400** `bad_request` for one that names no personal required check of this push); the reason is written on the first commit the push replays as `Armature-Local-Check-Override: <check> reason="..."`, the pusher's claim, which the remote keeps and does not enforce (it is not the remote's own `Armature-Check-Override`, which only the remote writes). A file the hub cannot read as requirements is **422** `personal_checks_invalid` with `issues`, never an open gate. A push with nothing to replay is not gated, and the file is not read.

Response: `{ workspace, pushed: [ { local, remote, parts, pushedAt } ], remoteHead, upToDate }`, with `checks` when personal requirements applied, the commits this push replayed, oldest first. What stops a push, each as the remote gave it with `remote: true`, `pushed` (what landed before it) and `at` (`{ local, part, total }`): **403** `forbidden` before the first commit, when the owner may not write the branch on the remote (`permission: "write"`; the warning at creation will usually have said so); **412** `precondition_failed` when the branch moved on the remote, with `moved`, the documents changed there since the last commit this hub pushed (someone else with a grant wrote it, or the owner pushed from another machine; bringing in is plan §14 step 4); **422** `invariant_violation` at the commit the remote refused, which means the local engine was older than the remote's or a rule depends on state this hub lacks. After any of these nothing is recorded for the refused commit; after **502** `remote_unreachable` the marker stays for the next push to settle. A second push of the same workspace while one runs is **409** `push_in_progress`. A workspace with nothing to push answers `upToDate: true`. Reads on this hub at a pushed commit by its remote identifier are served since 2026-11-02 (above).

### `POST /workspace/:name/bring-in`

Updates the workspace from its parent, `main` unless it was created from another branch (since 2026-11-20; `from: "main"` below is then that parent): with nothing left to push (**409** `unpushed_commits` with `unpushed` otherwise), the remote merges its `main` into the workspace's branch (`POST /branches/:ws/merge` with `from: "main"`, `If-Match` the last commit this hub pushed, checked before it commits), as the owner, who may merge into their own branch. Body, optional: `{ "message"? }` (`Bring in main` by default). The remote's answers come back as given with `remote: true`: **409** `merge_conflict` with `conflicts`, each a field with its base, target (the workspace's) and source (`main`'s) value, or `InsertConflict`; **422** `invariant_violation`; **412** when the branch moved on the remote (push's case). Nothing is resolved here: the review is the program's, and the resolution is ordinary local writes, pushed like any other (plan §6: restore the conflicting fields to their base value, push, bring in again, which then merges clean, then write the resolution). A clean merge is read back, the documents it changed at the merge commit, and written into the local branch as one commit, which the push table maps to the merge commit (`parts: 0`, `broughtIn: true`), so the next push continues from it; those documents were checked by the remote and are written here outside the pipeline (ADR-0062, note). A brought-in record naming an older commit this hub lacks gets its snapshot then, as at the clone.

The bring-in holds the workspace's write queue from its check to its local commit (since 2026-11-11; ADR-0025 decision 7, note of that day), as a delivery and a removal do: a write to the workspace sent meanwhile waits, then lands after what was brought in, and is **409** `document_moved` when it would replace a document the bring-in changed. The remote may merge and this hub not finish reading it back (a dropped connection is enough), so a marker is written to `push.json` before the request, `bringingIn: { ifMatch, localHead, merged?, sentAt }`, and the next bring-in or push settles one still there before anything else: the commit after `ifMatch` in the remote branch's log is the merge when it carries a merge's metadata, and what it changed is written here as above; otherwise nothing landed and the marker goes (ADR-0065 decision 6, note of 2026-11-11). Local commits made since stay unpushed, and what the merge changed is written after them, unless one of them changed a document the merge changed too: **409** `unpushed_commits` with `unpushed`, `merged` (the remote's merge commit) and `overlapping` (those documents), which a push does not clear, since no merge runs on a workspace hub to reconcile the two. A bring-in that finishes an earlier one and finds nothing newer answers with that one's `broughtIn`, without `merge`. Response: `{ workspace, remoteHead, upToDate, merge?: { base, source, target }, broughtIn?: { local, documents } }`.

### `GET /workspace/:name/merge-request`

Since 2026-11-20 (ADR-0072 decisions 5 and 7), in place of `POST /workspace/:name/deliver` and its dry run, which are gone. Answers `{ workspace, parent, request?, health?, mayMerge }`: the workspace's parent, the request open from the workspace into it with its health as the remote computes it for this read (Merge requests), and whether the owner may merge into the parent by the remote's own rule. Not a program action: a tool may read it, to show where the work is. The remote's refusals come back as given.

### `POST /workspace/:name/merge-request`

`{ message }` opens the request into the parent (**201**, the same shape); with nothing left to push (**409** `unpushed_commits`), since a request is about what the remote holds. 400 `message_required`, 400 `reserved_trailer`; the remote's **409** `request_open` when one is open. The remote's `main` is mirrored again first, so its required checks are read here. A program action, as the two below.

### `POST /workspace/:name/merge-request/merge`

`{ overrides?, deleteWorkspace? }`, the body optional: merges the open request, as the owner, where the remote lets them (its **403** `forbidden`, `permission: "merge"`, otherwise, when whoever may merge does so on the remote). With nothing left to push (409 `unpushed_commits`); **409** `no_request` when none is open. The remote checks and gates the merge, and its refusals come back as given with `remote: true`: `merge_conflict`, `invariant_violation`, `bring_in_first`, `checks_pending`, `checks_failed`, `nothing_to_merge`. `overrides` are the remote merge's. Answers `{ workspace, request, merged: { commit, base, source, target, upToDate }, checks?, deleted }`; `deleteWorkspace` then deletes the workspace on the remote, whose parent now holds its head, and removes it here. Holds the workspace's write queue throughout, as a bring-in does.

### `POST /workspace/:name/merge-request/close`

Closes the open request, unmerged: `{ workspace, request }`. 409 `no_request` when none is open.

### `GET /workspace/elsewhere`

Since 2026-11-20 (ADR-0072 decision 7). The caller's workspaces on the remote that this hub does not hold: `{ unlinked: [ { branch, parent } ], linkedElsewhere: [ { branch, parent, linkLabel?, linkedAt? } ] }`. The first can each be linked here (`POST /workspace` with `link`); the second are each linked to another computer, named by the label its owner gave it and never by its identifier. One linked to this installation with no copy here, a link whose clone did not finish, is among the first.

### `POST /workspace/:name/unlink`

Since 2026-11-20 (ADR-0072 decision 4), a program action. For a workspace this hub holds, unlinks it *from this computer*: with nothing left to push (**409** `unpushed_commits`), the remote's link is cleared and the copy here removed, everything in it being on the remote, where the workspace stays, linked to no computer. Answers `{ workspace, link }`, `link` being `cleared`, or `not_ours` when the remote no longer linked it here. For a workspace this hub does not hold, `{ "elsewhere": true }` unlinks it *from the other computer* (`POST /workspaces/:branch/unlink` on the remote): `{ workspace, unlinked, elsewhere: true, was? }`. That computer's commits not yet pushed can then no longer be pushed, which is the caller's to say before asking. Without `elsewhere` such a name is **404**, and with it a workspace held here is **409** `workspace_here`, so neither is asked for by mistake.

### `DELETE /workspace/:name`

Removes the workspace (since 2026-11-07), a program action as the three above, its owner's alone. With anything left to push it is **409** `unpushed_commits`. Otherwise the workspace goes from this hub (its branch here and its records) and the hub asks the remote to delete the branch, which the remote does when another branch holds its head, as `main` does after a delivery, and refuses otherwise (ADR-0025 decision 6). Response: `{ workspace, remote, reason? }`, `remote` being `deleted`, `kept` or `absent` (no such branch on the remote), and a kept branch's `reason` one of `unmerged` (commits no other branch holds: the branch stays on the remote as the record of that work, and can be cloned again), `forbidden` (the remote does not let the owner delete it) or `unreachable` (the remote did not answer; the local copy still goes, since nothing on it is unpushed). A refusal of this hub's own credential (`remote_identity`, `signed_out`) stops the removal and comes back as given. A removal that failed partway (a file another program held) is finished by asking again.

Since 2026-11-20 a branch the remote keeps stays there as a workspace linked to no computer, which can be linked again: the answer carries `link`, `cleared` when this installation's link was cleared, `kept` when the remote could not be asked or refused (its owner then unlinks it from another computer), `not_ours` when it was no longer linked here. A discard clears the link the same way when the remote answers, and goes on without that when it does not.

**A workspace of another remote** (since 2026-11-16). A workspace's record names the remote it was cloned from, and its actions go through that remote alone. A hub whose remote is another address (the program lets the remote change only while no workspace exists, which it can judge only for the folder in use: a folder set aside, a connection made elsewhere and the folder pointed at again) answers push, bring-in and deliver **409** `other_remote` with `workspace`, `clonedFrom` and `remote`, before anything is asked of a remote that never held the branch; the status answers with `remote: { reachable: false, reason: "other_remote" }`. A removal is the way out besides connecting to the first remote again: it removes such a workspace from this hub alone and answers `remote: "untouched"`, the hub's remote not asked, since a branch of that name there is someone else's; with commits never pushed it is **409** `unpushed_commits` as any removal is, and the discard gives them up.

**A discard, `?discard=<n>`** (since 2026-11-12; ADR-0065 decision 6, later change of that day): the removal of a workspace whose local commits will never be pushed, giving up n of them. The number is the confirmation: it must be the count of local commits not on the remote, a whole number of at least 1 (**400** `bad_query` otherwise), and a number that is not what is there is **409** `discard_mismatch` with `unpushed`, the commits that are there, and `stated`; nothing is removed. A discard asks nothing of the remote, so it works offline and signed out, and the remote's branch stays as the last push left it. Before the branch is deleted here, everything the workspace holds, its records and its branch's commit files, is copied to `_discarded/<branch>.<time>` in the hub's folder, which nothing reads again. Response: `{ workspace, remote: "untouched", discarded: { commits, setAside } }`, the commits given up, newest first, and where the files went, relative to the hub's folder. A discard that failed after the branch was deleted is finished by asking again, with `commits` empty.
---

## Error codes

| Status | Code | Meaning |
|---|---|---|
| 400 | `bad_request` | The body is not the expected JSON shape |
| 400 | `message_required` | A write has no `message` |
| 400 | `invalid_document` | A document fails its shape check (see `issues`) |
| 400 | `invalid_run` | A check run fails its shape check (see `issues`; Checks; since 2026-11-13) |
| 400 | `bad_cursor`, `cursor_too_old` | The event feed's `since` is not a cursor this hub gave, or is more than 1,000 commits behind on `branch`; ask again without it (Events; since 2026-11-15) |
| 400 | `invalid_type` | The type cannot be written through the document routes |
| 400 | `id_mismatch`, `type_mismatch` | The body's `@id` or `@type` disagrees with the path |
| 400 | `duplicate_id`, `duplicate_capture` | The same identifier or capture twice in one batch |
| 400 | `bad_id` | An identifier that does not begin with its type, or an identifier on a type that derives its own |
| 400 | `bad_link` | `Armature-Workspace-Link`, or a body's `link` or `linkLabel`, is not an installation's identifier (16 to 128 letters, digits, hyphens or underscores) or a label of one line (Workspaces; since 2026-11-20) |
| 400 | `workspaces_live_on_main`, `merge_requests_live_on_main` | A `Workspace` or a `MergeRequest` written for another branch than `main` (rule 27; met only by the operator's `put`, since no route writes either) |
| 400 | `unknown_field` | A filter or user field the type does not have |
| 400 | `ambiguous_ref`, `branch_required`, `write_at_commit` | Misused `branch` / `ref` parameters |
| 400 | `unsupported_version` | `Armature-Version` names a revision this hub does not serve (older, unknown, or newer on a write); `requested`, `supported` (ADR-0059) |
| 400 | `unsupported_capability` | `Armature-Capabilities` names a feature this hub lacks; `unsupported`, `supported` (ADR-0059) |
| 400 | `bad_if_match`, `bad_query`, `range_required`, `since_required` | Malformed headers or query parameters, `If-Match: *` among them |
| 400 | `not_an_ancestor` | A `since` commit the branch never held |
| 400 | `bad_name`, `protected_branch` | Branch name or `main` protection |
| 400 | `untraceable_type`, `users_live_on_main`, `person_filter_refused`, `unknown_profile`, `unknown_slice` | Route-specific refusals |
| 400 | `grants_live_on_main` | A `Grant` written to any branch but `main` (rule 21) |
| 400 | `requirements_live_on_main` | A `CheckRequirement` written to any branch but `main` (rule 23) |
| 400 | `reserved_trailer` | A message carrying `Armature-On-Behalf-Of`, `Armature-Relayed-By`, `Armature-Check`, `Armature-Check-Override` or `Armature-Merge-Request`, which the hub writes itself (Write envelopes; the last two since 2026-11-15) |
| 400 | `not_an_agent`, `not_a_person` | `Armature-Agent` names a person, or `Armature-User` names an agent beside it (Identity) |
| 400 | `remote_only` | A route or a write a workspace hub leaves to its remote (Discovery: `role`) |
| 400 | `workspace_only` | A workspace route on a remote hub (Workspace) |
| 401 | `identity_required`, `unknown_user`, `unknown_agent` | No identity, an unregistered one (a service's unregistered agent included), or an unregistered agent in `Armature-Agent`; under `oidc` with `WWW-Authenticate: Bearer` |
| 401 | `invalid_token` | Under `oidc`, a bearer token the hub refuses; `reason` says why (Identity; since 2026-11-05) |
| 403 | `forbidden` | The identity may not do this; `permission` and, as it applies, `branch`, `role` or `agent` (Grants; ADR-0068), `permission: write_requirement` with `branch`, the merge target, and `locked` (Check requirements; ADR-0070; since 2026-11-13), `permission: override_check` with `branch`, `check` and `locked`, a locked requirement overridden by anyone but an administrator (The merge gate; since 2026-11-15), or `permission: list_users`, the list of everyone registered, kept for maintainers of `main` and administrators under `oidc` (since 2026-11-05); `credential`, an agent as the credential itself on a remote hub (ADR-0067 decision 10); `owner`, anyone but the owner on a workspace hub, where `permission` may also be `push`, `bring-in`, `deliver` or `remove` (Workspace); `reason: local_token`, a write to a workspace hub without its `Armature-Local-Token` (Identity), or `reason: program_action`, push, bring in, deliver or remove called as a route on a workspace hub that serves them as the program's own actions (Workspace); both since 2026-11-03; `reason: relay` with `relayed`, a relay the hub refuses: `Armature-User` beside a person's token, a service without a `Relay` grant, a person or a branch the grant does not cover, an action other than a document write, or `Armature-Agent` beside it (Identity; since 2026-11-05) |
| 403 | `not_registered` | Under `oidc`, a valid token for a person the instance has not registered and does not admit on first sign-in (Identity; since 2026-11-05) |
| 403 | `forbidden` with `reason: remote_identity` | On a workspace hub reaching a remote under `oidc`: the remote resolves this hub's token to someone other than the workspace's owner, named in `credential` and `owner` (Workspace; since 2026-11-05) |
| 403 | `host_not_allowed`, `origin_not_allowed` | A host name or a web origin this hub does not serve (Hosts and web origins) |
| 404 | `not_found`, `unknown_type`, `unknown_ref` | No such document, type, branch or commit; on a workspace hub `unknown_ref` carries `remote_needed: true` when the commit may be the remote's and the remote could not be reached (Workspace) |
| 409 | `type_conflict` | An identifier held by another type (rule 12) |
| 409 | `user_exists`, `branch_exists` | Already registered or created |
| 409 | `merge_conflict`, `no_common_ancestor` | The merge cannot proceed |
| 409 | `checks_pending` | A merge's required check has no run that counts at the source's head; `pending` and `checks` (The merge gate; since 2026-11-15). On a workspace hub, a push's personal requirement likewise, at the workspace's head (The push gate) |
| 422 | `checks_failed` | A merge's required check did not pass at the source's head; `failed` and `checks`, the target unchanged (The merge gate; since 2026-11-15). On a workspace hub, a push's personal requirement likewise, nothing pushed (The push gate) |
| 422 | `personal_checks_invalid` | A workspace hub's `checks.json` cannot be read as personal requirements; `issues`; nothing is pushed until it is put right (The push gate; since 2026-11-15) |
| 409 | `unmerged_branch`, `branch_moved` | Branch deletion refused; `branch_moved` also a write whose branch moved under each of its three runs (The write pipeline), or a merge whose target moved during its check (Branches: merge) |
| 409 | `document_moved` | A write without `If-Match` lost its race to a commit that changed a document it replaces; `documents`, `checked`, `current` (Optimistic concurrency) |
| 409 | `registration_conflict` | Concurrent user registration; retry |
| 409 | `push_in_progress` | A push of the same workspace is already running on this hub (Workspace) |
| 409 | `discard_mismatch` | A discard (`DELETE /workspace/:name?discard=<n>`) whose number is not the count of local commits not on the remote, with `unpushed` and `stated`; nothing was removed (since 2026-11-12; Workspace) |
| 409 | `unpushed_commits`, `bring_in_first` | A bring-in, delivery or removal with local commits not yet pushed, or, with `overlapping`, a bring-in or push that cannot finish an earlier bring-in under them; a delivery before `main` was brought in cleanly, with the dry run's `conflicts` and `violations` (Workspace); on a remote hub, a merge with required checks whose source lacks the target's head, with `checks` (The merge gate; since 2026-11-15) |
| 409 | `workspace_exists` | A workspace this hub already holds (Workspace) |
| 409 | `other_remote` | A workspace's push, bring-in or delivery on a hub whose remote is not the one the workspace was cloned from; `workspace`, `clonedFrom`, `remote` (since 2026-11-16; Workspace, "A workspace of another remote") |
| 409 | `request_required` | A merge into `main`, or from a workspace, made outside a merge request; `source`, `target`, `reason` (`into_main`, `from_workspace`). Open a request and merge it; a dry run is still answered (Merge requests; since 2026-11-20) |
| 409 | `held_elsewhere`, `not_linked` | A write to a workspace's branch (a document, a merge into it, its deletion) from an installation it is not linked to, with `workspace`, `linkLabel?` and `linkedAt`; or to a workspace linked to no computer (Workspaces; since 2026-11-20) |
| 409 | `parent_is_workspace`, `target_is_workspace`, `workspace_exists` | A workspace created from a workspace, or recorded with one as its parent; a merge request into a workspace; a branch recorded as a workspace that already is one (since 2026-11-20) |
| 409 | `request_open`, `request_decided`, `nothing_to_merge`, `branch_gone`, `no_request` | A second open request for a source and a target (`request` names the first); a request already merged or closed; a request whose target holds everything on its source; a request naming a branch that no longer exists; and, on a workspace hub, a workspace with no open request (Merge requests, Workspace; since 2026-11-20) |
| 409 | `workspace_here` | `POST /workspace/:name/unlink` with `elsewhere` for a workspace the hub holds (since 2026-11-20) |
| 412 | `precondition_failed` | The branch moved since the commit in `If-Match` |
| 413 | `body_too_large` | A request body over 10 MiB |
| 422 | `invariant_violation` | One or more rules broken (see `violations`), by a write or by the state a merge would make (Branches: merge) |
| 422 | `group_too_large` | A local commit holds a group of documents naming each other that no one request can carry (Workspace: push) |
| 500 | `store_unavailable` | The database rejected the configured credentials |
| 500 | `store_error`, `internal_error` | An unexpected database or server error (details in the server log only) |
| 500 | `history_too_long` | A history longer than the 5,000 commits the hub walks (the changes route, a merge, a branch delete) |
| 502 | `remote_unreachable`, `remote_error` | A workspace hub could not reach its remote, or the remote answered without what the hub needed (Workspace); `reason: etag_altered` when the remote's `ETag` is not a commit identifier, a proxy having altered it (since 2026-11-05); since 2026-11-16 also `redirect` with `location` (the remote answered a redirect, which the hub does not follow), `not_a_commit` (a merge's, a batch's or a log entry's commit is no commit identifier), `log_repeats` with `commit` and `log_without_base` with `base` (the remote's log at a clone does not page, or lacks the commit cloned at) and `not_a_document_of_type` with `type` (the remote listed something else among its `User` or `CheckRequirement` documents) |
| 503 | `branch_busy` | A document's history could not be read at one head; `Retry-After` |
| 503 | `store_unreadable` | A file of a workspace hub's folder could not be read on this machine although it is there, such as one a sync service has made cloud-only while the service is stopped or the machine offline; `path` names it, `Retry-After`, and the hub reads the folder again on the next request (since 2026-11-03) |
| 503 | `store_unwritable` | A file of a workspace hub's folder could not be replaced because another program held it (a sync client under Windows refusing the rename) for longer than the hub's retries, about 2.5 seconds; `path` names it, `Retry-After`; the old file stands, nothing is lost, and the request can be sent again (since 2026-11-03) |
| 503 | `issuer_unreachable` | Under `oidc`, the identity provider's keys or metadata could not be read, or answered an error; the hub tries again on the next request (since 2026-11-05; a key set answering an error was 401 `invalid_token` until 2026-11-12) |
| 504 | `store_timeout` | The database did not answer within the hub's 30-second deadline; a write may have landed, so re-read before retrying |
