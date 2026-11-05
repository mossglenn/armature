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

A write may send `If-Match: "<commit-id>"`, meaning "apply this only if the branch is still at this commit." If anyone has committed to the branch since, the write is refused with **412** (`precondition_failed`), and the body carries `expected` and `current` commit identifiers. The token is the branch head, not a fingerprint of one document, so a 412 may mean someone changed a different document; re-read and retry. `If-Match: *` (HTTP's "the resource exists") is refused with 400 `bad_if_match`, since a branch head cannot express it (since 2026-10-31; it was read as no condition). Without `If-Match`, a write is not conditioned on what the client read, but it is checked and committed at one commit: the hub conditions it on the head its rules were checked at, and if another commit lands in between, runs the whole write again on the new head, up to three runs, then answers **409** `branch_moved` with nothing written (since 2026-10-31; the deep review's B2). That rerun refuses rather than overwrites when the commit it lost to changed a document the write replaces: **409** `document_moved` with `documents`, `checked` and `current` (since 2026-11-01; ADR-0025 decision 7, note), so a concurrent edit of the same record is never silently undone; read again and write with `If-Match`. A stale `If-Match` is refused before the write's rules are checked, so its 412 comes before a `type_conflict` or an `invariant_violation`. `If-None-Match` is not supported.

### Identity: `Armature-User`, or a bearer token

Every route that changes data needs an identity (ADR-0032), and under `oidc` every route but `GET /discover` does (below). Under the default `header` resolver, the request carries `Armature-User: <externalId>`, the external identifier of a registered `User` (the seed registers `demo-designer@example.edu`). The hub resolves it to a `User` document on `main`, records that user as the commit author, and sets `createdBy` on documents it creates. Missing header: **401** `identity_required`. Unregistered identifier: **401** `unknown_user`.

Since 2026-11-01 a request may also carry `Armature-Agent: <agent externalId>`, a registered agent `User` (one whose `externalId` begins with `agent:`), under every resolver (ADR-0067 decisions 3 and 8). The person in `Armature-User` is resolved first and the agent second: the agent is the commit's author and the `createdBy` of what it creates, the person's authority decides the request (below), and the hub appends `Armature-On-Behalf-Of: <person externalId>` to the commit message. An agent that is not registered: **401** `unknown_agent`; a person named as the agent: **400** `not_an_agent`; an agent's identifier in `Armature-User` beside `Armature-Agent`: **400** `not_a_person`. A request naming an agent directly in `Armature-User` may read; on a remote hub it may not write, create a branch, merge, delete, grant or register: **403** `forbidden` with `credential` naming the agent (ADR-0067 decision 10, since 2026-11-01). An agent's own work reaches a remote only as a workspace hub's push, acting for the workspace's owner (Workspace).

**A workspace hub's local token (ADR-0065 decision 7, since 2026-11-03).** Every request to a workspace hub that is not a read (any method but GET, HEAD and OPTIONS) also carries `Armature-Local-Token: <value>`, the hub's per-launch secret. The desktop program draws it at each start and keeps it in memory; a tool the program launched reads it from its environment as `ARMATURE_LOCAL_TOKEN`, a tool started elsewhere has it pasted once from what the program shows. Until the program exists the hub's own process draws and prints it at start, or takes `ARMATURE_LOCAL_TOKEN` (`deployment.md`, "A workspace hub on this machine"). A write without it, or with another value, is **403** `forbidden` with `reason: local_token`, checked before identity; reads need nothing. It says only "a tool the program started": identity stays `Armature-User`'s, and a workspace hub still authorizes nothing. A remote hub neither requires nor reads the header. `GET /discover` says `localToken: required` under `armature/workspace`.

**Authorization (ADR-0068, since 2026-11-01).** Once the identity is resolved, a remote hub checks that it may do what it asks, from the `Grant` documents in force on `main` (the Grants section), and refuses with **403** `forbidden`, naming the missing `permission` (`create`, `write`, `merge`, `delete`, `grant` or `register`) and, as it applies, the `branch`, the `role` or `agent`. An agent acting for a person may do what the person may. A workspace hub does not check grants; it keeps each workspace to its owner (**403** `forbidden` with `owner` for anyone else, since 2026-11-01), warns at creation when the remote would refuse the owner, and leaves the refusal to the remote's push (ADR-0068 decision 9; Workspace). The capability `armature/authorization` in `GET /discover` says the hub authorizes.

The `header` resolver trusts the caller. While it is configured, the hub is reachable only from its own server (its port on loopback; `deployment.md`), and a tool that writes runs there or behind a proxy that authenticates and sets the header itself.

**The `oidc` resolver (OpenID Connect; ADR-0067 decision 1, since 2026-11-05).** A hub under `ARMATURE_IDENTITY=oidc` takes no `Armature-User`: every request carries `Authorization: Bearer <token>`, a JSON Web Token the instance's identity provider signed, which the hub verifies against the provider's published keys, checking the issuer and the audience `GET /discover` names (`identity.issuer`, `identity.audience`), the expiry, and the algorithm (`RS256`, `ES256` or `EdDSA`). Every request needs one, reads included; `GET /discover` and the health probes (Discovery) alone stay open. No token: **401** `identity_required`; a token the hub refuses: **401** `invalid_token` with `reason` (`expired`, `audience`, `issuer`, `signature`, `algorithm`, `unknown_key`, `not_yet_valid`, `malformed`); both carry `WWW-Authenticate: Bearer`. A person's token resolves by `(issuer, sub)`: `sub` is the `externalId`, and a `User` registered under `oidc` carries `issuer`, so a `User` registered without one (the seed's) is never a token's subject. First sign-in registers a person, from the token's `name` and `email`, only when `ARMATURE_OIDC_ADMIT` admits the token: it lists issuers and email domains, a domain matched against the token's `email` unless the token marks it unverified, and empty admits no one. Otherwise a valid token is **403** `not_registered` until an administrator registers the person with `POST /users`, naming `issuer`. A service's token, issued to a program with no person present by the client credentials grant (decision 4), carries no `name` and names its client in `azp` or `client_id`; it resolves to the agent `User` whose `externalId` is `agent:<client id>`, registered by a person as any agent is (**401** `unknown_user` until then), and reads only (decision 10). `Armature-Agent` works beside a person's token exactly as under `header`. An issuer whose keys cannot be read: **503** `issuer_unreachable`. Under `oidc` the list of everyone registered is kept for a maintainer of `main` or an administrator, and a full export to anyone else carries only the users its records name (Users; Export). Native sign-in (decision 2) is not built yet; a workspace hub runs under `header` and signs in to its remote from its host.

**A relay (ADR-0067 decision 5, since 2026-11-05).** A service may deliver a person's earlier work as the person's, which is how an outbox drains after the reviewer has gone: it sends its own token and `Armature-User: <person externalId>`, and the hub resolves the person as the author, the `createdBy` and the `attestedBy`, appending `Armature-Relayed-By: <agent externalId>` to the commit message. Only a service whose agent `User` holds an active `Relay` grant on `main` (Grants) may do it, and only for the people the grant names in `relayedUsers` (any registered person when absent), on a branch the grant covers (`branch`; every branch when absent), as documents (`PUT` and `POST /documents`): the person's own grants then decide the write, as for anyone. Every other refusal is **403** `forbidden` with `reason: relay` and `relayed` naming the person: `Armature-User` beside a person's token, a service with no `Relay` grant, a person the grant does not name, a branch it does not cover, an action that is not a document write (a branch, a merge, a grant), or `Armature-Agent` beside the relay. A person the relay names who is not registered: **401** `unknown_user`; an agent named: **400** `not_a_person`. `GET /users/me` under a relay answers the person, with `relayedBy`.

### Hosts and web origins

Every request is checked before anything else (ADR-0067 decision 7, since revision 2026-10-30). The hub answers a request whose `Host` is a loopback name (`localhost`, `127.0.0.1`, `[::1]`, or a name under `.localhost`, any port) or a name listed in `ARMATURE_ALLOWED_HOSTS`; any other is **403** `host_not_allowed`, so a web page that points its own domain at the hub's machine (DNS rebinding) is refused. A request with an `Origin` header, which browsers send, is **403** `origin_not_allowed` when the origin is `null` or a remote web origin not listed in `ARMATURE_ALLOWED_ORIGINS`; loopback origins and non-web schemes such as `tauri://localhost` (a desktop shell) are served. Only a listed origin gets CORS (cross-origin resource sharing) answers: `OPTIONS` preflights (204), and `Access-Control-Allow-Origin` with `ETag` and `Armature-Version` exposed on every response, refusals included. Tools outside a browser send no `Origin` and need nothing.

### Write envelopes

Every write body is a JSON object with a required, non-empty `message`: the reason for the change, stored as the commit message and returned by the history route byte for byte, git-style trailers included (verified 2026-10-30, platform check AJ). Two trailers are the hub's own (ADR-0067 decision 6): it writes `Armature-On-Behalf-Of: <person>` when an agent acts for a person and `Armature-Relayed-By: <agent>` when a service relays a person's earlier work (Identity; since 2026-11-05), and refuses a message carrying a line that begins with either, **400** `reserved_trailer`; every other trailer is the caller's claim, kept as sent (`Co-Authored-By: <name>` for someone who contributed without signing in; the workspace trailers of ADR-0065 decision 5 when push exists). A write without a message is a **400** `message_required`. A request body may be at most 10 MiB (10,485,760 bytes), checked before it is read; a larger one is a **413** `body_too_large` (since 2026-10-31). The other fields depend on the route: `{ message, document }`, `{ message, documents }`, `{ message, from }`, `{ message, user }`. Branch creation takes `{ name, from }` with no message; since 2026-11-01 it commits the caller's `Owner` grant on `main` under a message the hub writes, and so needs an identity (Branches).

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

The structural difference in one document between two commits, as TerminusDB's JSON patch (`docs/vendor/terminusdb/json-diff-and-patch.md`), passed through unchanged; every store under a hub produces it (ADR-0066 decision 5, accepted 2026-11-02; the file-backed store's segmentation of a list may differ, its operations do not). Both are required (400 `range_required`) and must exist (404 `unknown_ref`). Response: `{ id, from, to, diff }`.

### The write pipeline

`PUT /documents/:type/:id` and `POST /documents` run the same steps (`app/lib/api/write.ts`), after the permission check (Identity; ADR-0068): a document in the batch needs the right to write the branch, and a `Grant` the right to grant that role on that branch, else **403** `forbidden` before anything is read.

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

Every `ArmatureDocument` may carry `externalRefs` (identifiers in other systems: `{ "@type": "ExternalRef", system, identifier, label? }`) and `attachments`; every fragment may carry `attachments` (`{ "@type": "Attachment", store, storeUri, contentHash, hashAlgorithm, revision?, path?, container?, mediaType?, byteSize?, role?, label? }`). Both are embedded subdocuments: send them inline, never store their nested `@id`, and expect the field to be absent on read when the set is empty. The hub checks their shape and rules 18 and 19; it does not fetch bytes or verify a hash in this phase (ADR-0030).

There is no route that deletes a document. Lifecycle changes are status changes (`ItemStatus.Retired`, `FindingStatus.Dismissed`, `ObjectiveState.Archived`), which keep every reference and every line of history; deletion is an administrative operation outside the API (ADR-0024 decision 5; ADR-0062 built that operator surface on 2026-10-22: a delete as a commit, a whole-branch rule check, and a replace that can skip the hub's rules, run in the hub's container and none of it on `/api/v1`; `docs/deployment.md` § Repair). A deleted document reads as 404 `not_found`, and its id may be written again.

---

## Branches

### `GET /branches`

Every branch with its latest commit: `[ { name, head: { commit, author, message, timestamp, metadata? } } ]`. A branch deleted by another request while the list is being read is left out.

### `POST /branches`

Creates a branch. Body: `{ "name": "...", "from": { "branch": "main" } }` or `{ "name": "...", "from": { "commit": "<commit-id>" } }`; `from` defaults to `main`. Names must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$` (400 `bad_name`). An existing name: 409 `branch_exists`; a `from` branch or commit that does not exist: 404 `unknown_ref`. Response **201**: `{ name, from, head }`. Headers: `Armature-User` (required since 2026-11-01). Any registered person may create a branch, and whoever does owns it (ADR-0068 decision 3; an agent as the credential itself may not, **403** `forbidden` with `permission: "create"`, ADR-0067 decision 10): before the branch exists the hub writes the caller's `Owner` grant on `main`, as a commit of its own, so a branch cut from `main` starts at the commit that records its owner. Under `Armature-Agent` the person owns it.

### `GET /branches/:name`

The branch's latest commit: `{ name, head }`, with the commit in `ETag`.

### `POST /branches/:name/merge`

Merges another branch into `:name` with the database's three-way merge (ADR-0025 decision 5), **checked before it commits** (since 2026-11-01; decision 5's note of 2026-10-30): the source is applied onto a transient branch cut at the target's head, the invariants engine runs over the whole result, and only a result that breaks no rule is applied onto the target, so two clean branches can no longer merge into a violation such as `duplicate_sequence`. A result that breaks a rule is **422** `invariant_violation` with `violations`, `base`, `source` and `target`, the target unchanged. The transient branch (`operator-merge-…`) is deleted on every outcome; one left by a crash is reported by the operator's `check` and deleted by its scratch-branch deletion. The store's `apply` takes no precondition (platform check AK), so the target's head is read again just before the merge lands and a branch that moved meanwhile is **409** `branch_moved`; the residual window is one request wide, as a branch delete's is.

- Headers: `Armature-User` (required).
- Who may (ADR-0068 decision 4, since 2026-11-01): into a branch, its owner or a maintainer of it or of every branch; into `main`, a maintainer of `main` or of every branch; else **403** `forbidden` with `permission: "merge"`. A branch with no owner is open to any registered user while the migration window is open (Grants).
- Headers: `If-Match` (optional, since 2026-11-01): the target head the caller inspected; **412** `precondition_failed` when it moved.
- Body: `{ "message": "...", "from": "<source branch>", "dryRun"?: true }`.
- Success: `{ commit, base, source, target, upToDate: false }`. The merge commit records the merged source commit in its metadata (`armature.mergeSource`).
- Dry run (`dryRun: true`, since 2026-11-01): **200** `{ base, source, target, upToDate, dryRun: true, conflicts, violations }` and nothing committed, whatever it finds; the merge would land when both lists are empty. An up-to-date dry run carries `commit` (the target head) and empty lists.

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

There are no reset, squash or rebase routes: shared history is never rewritten.

---

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
| `Relay` | A service delivering a person's earlier work with the person as author, bounded by `relayedUsers` and `expires` (ADR-0067 decision 5; not yet built). Held by agents |

Who may write a grant: `Maintainer` on a branch, its owner or an administrator; anything else, an administrator (**403** `forbidden`, `permission: "grant"`). An instance's first administrator comes from the seed or the operator's `put` (ADR-0068 decision 6). A branch created before 2026-11-01, or around the API, has no owner: it stays writable, mergeable and deletable by any registered user while the migration window is open, which `GET /discover` reports as `ownerlessBranches: "writable"` under `armature/authorization`; an administrator assigns an owner by writing the grant. Grants are listed by holder, `GET /documents/Grant?user=User/<id>` (decision 8), and `GET /users/me` carries the caller's. The pseudonymous and institutional export profiles rewrite `user`, `relayedUsers`, and a handle prefix in `branch` (a workspace branch's `<handle>_`) to the person's token (ADR-0031).

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

Profiles rewrite people only. `full` keeps `User` documents as stored. `pseudonymous` replaces every `User` by `{ "@id": "User/<token>", "@type": "User", "externalId": "<token>" }` and rewrites every reference to a user (`createdBy`, `attestedBy`, any field whose target is `User`) to the token's id; nothing else about the person is kept. `institutional` adds `institution` to that. The token is an HMAC-SHA256 of the `User` id under `ARMATURE_EXPORT_KEY`; with the key set, `pseudonyms` is `stable` and the same person has the same token in every export of the deployment; without it a key is minted per export and `pseudonyms` is `per-export`. Free text is not scrubbed.

A slice is a named list of classes (`GET /export/slices`); a document is included when its type is one of them or inherits one. `unresolved` lists every reference from an included document to one that is not included (`{ id, field, target }`); nothing is dropped from a document. The `full` slice has none and is the only one that reproduces the graph when re-imported.

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
  versions:     [ "2026-11-05", "2026-11-03", ... ],       // the revisions served, newest first
  identity:     { resolver: "header",                      // or "oidc" (since 2026-11-05)
                  headers: { "Armature-User": "person", "Armature-Agent": "agent" } },
                                                           // under oidc: headers { Authorization: "bearer", "Armature-Agent": "agent",
                                                           //   "Armature-User": "relay" }, issuer, audience, clientId
  capabilities: { "armature/documents": { fallback: "reject", batchLimit: 500, historyCount: 20, readOnlyBranches: [] },
                  "armature/branches": { fallback: "reject", remoteOnly: [] },
                  "armature/intelligence.coverage": { fallback: "reject", fullyAssessedAt: 2, overAssessedAbove: 4 },
                  ... },                                   // each with its fallback and its settings
  schema:       { route: "/api/v1/schema" }
}
```

`identity` says how to authenticate (ADR-0067 decision 9, since 2026-11-05): the resolver, the headers a client may send with what each names (`person`, the caller; `agent`, a registered agent acting for the caller; `bearer`, the token; `relay`, a service naming the person whose earlier work it delivers under a `Relay` grant), and under `oidc` the `issuer` and `audience` a token is checked against and, when the instance set one, the `clientId` a native program signs in with (`ARMATURE_OIDC_CLIENT_ID`). The admission list is not published.

A capability's `fallback` says what a hub that lacks it does with a request that declares it: `reject` (refuse by name) or `ignore` (serve under core behavior). Every capability the hub defines is `reject`. The settings are the defaults of the behavior's parameters, so a client can read them rather than assume them.

A workspace hub also lists `armature/workspace` (Workspace), with its settings `profile`, the export profile a clone takes, `localToken: required` (every write carries the hub's per-launch secret; Identity) and `actions`, `routes` when push, bring in and deliver are served as routes on this hub or `program` when they are the desktop program's own and the routes are refused (both since 2026-11-03); a remote hub neither lists nor accepts it. A remote hub lists `armature/authorization` (Grants; since 2026-11-01): the hub authorizes, a **403** `forbidden` is possible, `GET /users/me` carries grants, and its one setting, `ownerlessBranches`, says whether a branch with no owner is still `writable`; a workspace hub, which does not authorize, lists it not.

`role` is what kind of hub this is (ADR-0065; [workspace hub plan](workspace-hub-plan.md) §9). A **remote** hub is a hub as built. A **workspace** hub, `ARMATURE_ROLE=workspace` with the remote's address in `ARMATURE_REMOTE_URL`, is the same API on one person's machine; what changes the remote's shared state happens on the remote, so it refuses those routes with **400** `remote_only`, and they are listed under their capability's `remoteOnly` as `METHOD /api/v1/path`: `POST /branches`, `POST /branches/:name/merge` and `DELETE /branches/:name` under `armature/branches`, `POST /users` under `armature/users`. Its `main` is the remote's, mirrored, and listed in `armature/documents`'s `readOnlyBranches`: read as on any hub, a write to it is `remote_only`. It registers no one: an identity its mirror does not hold is **401** `unknown_user`, to be registered on the remote. On a remote hub both lists are empty.

### `GET /schema?branch=|ref=`

The schema graph at a ref (ADR-0027 decision 4), so a tool discovers types, categories and fields from the hub rather than from a copy of `schema.json`: `{ ref, schema: [ { "@type": "@context", ... }, { "@id": "LearningObjective", "@type": "Class", ... }, ... ] }`, with the commit in `ETag`. The entries are in the form the export carries and the store reloads (the store's own `@max_cardinality: "inf"` decoration removed; ADR-0031). Every class carries `@metadata.armature.category`.

---

### `GET /health/live` and `GET /health/ready`

Two probes for whatever watches a hub (since 2026-11-05; ADR-0067 decision 7, note): `live` answers `{ live: true }` whenever the process does, with no store; `ready` answers `{ ready: true }` when the registry branch's head can be read, else **503** `not_ready` with `Retry-After`. Both are open without a token under `oidc`, as `GET /discover` is, since a probe cannot sign in, and say nothing about the graph. The hub's container image uses `live` as its health check.

---

## Workspace

Served by a workspace hub only (ADR-0065; [workspace hub plan](workspace-hub-plan.md) §4), under `armature/workspace`, which only such a hub lists in `GET /discover` and accepts in `Armature-Capabilities`. A remote hub answers these routes with **400** `workspace_only`. Since 2026-11-01. The workspace hub calls its remote (`ARMATURE_REMOTE_URL`) as an ordinary client of `/api/v1`, acting as the caller; a refusal from the remote comes back with the remote's own status and code and `remote: true`, and a remote that cannot be reached is **502** `remote_unreachable`. A remote under `oidc` is called with the owner's bearer token, which the workspace hub's host supplies (`ARMATURE_REMOTE_TOKEN` for the hub's process; ADR-0067 decision 2, note of 2026-11-05), and no `Armature-User`; before a workspace is made, pushed, brought in or delivered the remote's `GET /users/me` must resolve that token to the owner, else **403** `forbidden` with `reason: remote_identity`, `owner` and `credential`.

Push, bring in and deliver (since 2026-11-01, later the same day) are the rest of the cycle, each through that same client (ADR-0065 decisions 5 and 6 with their notes; plan §4 to §6). They are the owner's actions: the desktop program's own when it exists (ADR-0065 decision 7, note), and until then the routes below, served only on a hub started with `ARMATURE_WORKSPACE_ACTIONS=routes` (the `workspace` compose profile does); elsewhere each is **403** `forbidden` with `reason: program_action` and `permission` naming the action, before the workspace is looked up, and `GET /discover` says `actions: program` (since 2026-11-03; until then the routes were open to any process on loopback). Like every write to a workspace hub, each carries `Armature-Local-Token` (Identity). On a workspace hub a workspace is written, pushed, brought up to date and delivered by its owner, or by an agent acting for its owner; a request as anyone else is **403** `forbidden` with `owner` and `permission` naming the action (plan §7).

A workspace's record: `{ branch, remote, owner, ownerExternalId, from?, base, local, clonedAt }`: the branch (the same name on the remote and here), the remote's address, the owner's `User` id on the remote and external identifier, the remote branch it started from when this hub created it, the remote commit cloned (the *base*), the local commit holding the clone, and when. Records are kept in the folder `ARMATURE_WORKSPACE_DIR` names, outside the store; beside each record, after its first push, `push.json`, the push table (below), and since 2026-11-02 `snapshots.json` and `log.json` (next).

**What the clone holds, and remote commit identifiers** (since 2026-11-02; plan §8, §16 question 3; ADR-0065 decision 5, note). A clone is the branch's export at the base, and beyond it the remote's state at each older commit a cloned or brought-in record names in `asOf` (a *snapshot*: the remote's full export at that commit, loaded into a branch of this hub's store named `at.<commit>`, left out of `GET /branches` and refusing writes with **400** `remote_only`), taken most-referenced first within a budget of commits per workspace (`ARMATURE_SNAPSHOTS`, 20 by default), and the remote branch's log back to its beginning. On a workspace hub a remote commit identifier then works wherever a commit works: `?ref=` naming the base, a pushed or brought-in commit, or a held snapshot is served here, with `ETag` the identifier asked for; `If-Match` may name the remote identifier of the head's counterpart; `GET /branches/:name/log` on a workspace continues past the clone's own commits with the remote's entries from the base back. A read at a commit this hub does not hold is forwarded to the remote when it can be reached, read-only and as the caller (the state at that commit is read once as the remote's export and the read runs here over it, so the answer is the one the remote gives), and is **404** `unknown_ref` with `remote_needed: true` and `remote` when it cannot. A write whose `asOf` names such a commit is checked the same way online, and offline is **422** `unknown_commit`. So constraints 13 and 16 and the attestation staleness read work offline for everything the snapshots cover.

### `GET /workspace`

The workspaces this hub holds, their records, by branch name.

### `POST /workspace`

Needs an identity, which the remote resolves (an identity it does not know is its **401** `unknown_user`, with `remote: true`). Body, one of:

- `{ name, from? }`: creates the branch `<handle>_<name>` on the remote from the branch `from` (`main` by default), then clones it. `<handle>` is the caller's external identifier before the `@`, in the characters a branch name allows: a naming convention, not ownership (ADR-0068). The branch name must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$`, else **400** `bad_name`.
- `{ existing }`: clones a branch the remote already has, as it is.

Both first mirror the remote's `main` into this hub's `main` (its schema, the owner's own `User` from `GET /users/me` and every agent from `GET /users?kind=agent`, read at one remote commit; nothing is written when nothing changed; until 2026-11-05 every `User`, which under `oidc` is a maintainer's read), then load the branch's export at its head, `full` profile and the whole graph, into a local branch of the same name, its schema in one commit and its documents in a second. A local branch of that name with no record is an interrupted clone and is replaced when it holds only a clone's own commits; one with other work is **409** `branch_exists`. The base is the export's `ETag`, which must be a bare commit identifier: one a proxy in front of the remote has altered (a compressing proxy appends the encoding's name, `"<commit>-gzip"`) is **502** `remote_error` with `reason: etag_altered` and `commit`, before anything is written, since such a base would be refused at every push (since 2026-11-05; found on the Droplet, [deployment](deployment.md), "An instance under `oidc`"). A workspace this hub already holds is **409** `workspace_exists`. Answers **201** with the record and `snapshots`, the snapshot records (`{ commit, references, held, documents?, fetchedAt?, reason? }`; `reason` is `budget` or the remote's refusal code). For `{ existing }` the hub first asks the remote whether the caller may write the branch (their grants from `GET /users/me`, the branch's `Grant` documents, judged by the remote's own rule) and, when not, adds `warning: { code: "forbidden", message, holders }` to the record it answers, `holders` the `User` ids holding `Owner` or `Maintainer` of the branch on the remote; the workspace is made either way, to read, to work in while asking for a grant, or to carry its content elsewhere (ADR-0068 decision 9; since 2026-11-01). A workspace this hub created is the caller's own, so it carries none. The warning is not stored. If the remote branch was created and the clone then failed, retry with `{ existing }`.

### `GET /workspace/:name/status`

`{ workspace, head, localCommits, pushed, unpushed, snapshots, remote }`: the record, the local head, the number of local commits since the clone and how many of them are pushed, the snapshots (`{ budget, held: [commit], declined: [record] }`), and the remote branch's head with `moved` (whether it differs from the last commit this hub pushed, the base before any push), or `{ reachable: false }` when the remote cannot be reached. **404** `not_found` for a workspace this hub does not hold.

### `POST /workspace/:name/push`

Replays every local commit since the clone that is not yet on the remote, oldest first, each as one `POST /documents` on the remote with `If-Match` naming the remote commit the previous replay produced (the base for the first), as the owner, or as the agent acting for the owner when an agent made the commit here (`Armature-Agent`, so the remote records the agent as author and writes `Armature-On-Behalf-Of` itself). Needs an identity: the workspace's owner, or an agent acting for them (**403** `forbidden`, `permission: "push"`, otherwise). The documents are the commit's own, read at that commit, with the store's nested ids left out and every `asOf` that names a local commit rewritten to the remote commit it became, exactly, since the workspace has one writer and replay starts from the base; a `User` copy the local pipeline carried onto the branch is left out, since the remote carries its own. The message is the local one, the hub's own trailers removed (the remote writes them again) and these appended, the pusher's claims, which the remote keeps as sent (ADR-0065 decision 5):

```
Armature-Workspace-Commit: <local commit id>
Armature-Authored-At: <ISO 8601 time of the local commit>
Armature-Workspace-Part: <n>/<total>         only when the commit was split
```

A local commit larger than one request (500 documents, 10 MiB) is replayed as several, each an ordinary write the remote checks: its documents are ordered so that each follows what it names, documents that name each other stay in one request, and a group no request can hold is **422** `group_too_large` with `documents` (the split rule, ADR-0065 decision 5, note of 2026-10-30; platform check AL found the store takes the hub's cap with room to spare, so the cap is the hub's). The commit table, `push.json` beside `workspace.json`, maps each local commit to the remote commit it became: `{ commits: [ { local, remote, parts, pushedAt } ], inFlight? }`. The in-flight marker is written before each request, so a push interrupted after the remote accepted one (a dropped connection, a crash) is settled by the next push from the remote branch's log (`GET /branches/:name/log`), which carries the trailers above when it landed: landed is recorded, not landed is sent again, once (ADR-0066 decision 2, note).

Response: `{ workspace, pushed: [ { local, remote, parts, pushedAt } ], remoteHead, upToDate }`, the commits this push replayed, oldest first. What stops a push, each as the remote gave it with `remote: true`, `pushed` (what landed before it) and `at` (`{ local, part, total }`): **403** `forbidden` before the first commit, when the owner may not write the branch on the remote (`permission: "write"`; the warning at creation will usually have said so); **412** `precondition_failed` when the branch moved on the remote, with `moved`, the documents changed there since the last commit this hub pushed (someone else with a grant wrote it, or the owner pushed from another machine; bringing in is plan §14 step 4); **422** `invariant_violation` at the commit the remote refused, which means the local engine was older than the remote's or a rule depends on state this hub lacks. After any of these nothing is recorded for the refused commit; after **502** `remote_unreachable` the marker stays for the next push to settle. A second push of the same workspace while one runs is **409** `push_in_progress`. A workspace with nothing to push answers `upToDate: true`. Reads on this hub at a pushed commit by its remote identifier are served since 2026-11-02 (above).

### `POST /workspace/:name/bring-in`

Brings `main` into the workspace: with nothing left to push (**409** `unpushed_commits` with `unpushed` otherwise), the remote merges its `main` into the workspace's branch (`POST /branches/:ws/merge` with `from: "main"`, `If-Match` the last commit this hub pushed, checked before it commits), as the owner, who may merge into their own branch. Body, optional: `{ "message"? }` (`Bring in main` by default). The remote's answers come back as given with `remote: true`: **409** `merge_conflict` with `conflicts`, each a field with its base, target (the workspace's) and source (`main`'s) value, or `InsertConflict`; **422** `invariant_violation`; **412** when the branch moved on the remote (push's case). Nothing is resolved here: the review is the program's, and the resolution is ordinary local writes, pushed like any other (plan §6: restore the conflicting fields to their base value, push, bring in again, which then merges clean, then write the resolution). A clean merge is read back, the documents it changed at the merge commit, and written into the local branch as one commit, which the push table maps to the merge commit (`parts: 0`, `broughtIn: true`), so the next push continues from it; those documents were checked by the remote and are written here outside the pipeline (ADR-0062, note). A brought-in record naming an older commit this hub lacks gets its snapshot then, as at the clone. Response: `{ workspace, remoteHead, upToDate, merge?: { base, source, target }, broughtIn?: { local, documents } }`.

### `POST /workspace/:name/deliver`

Delivers the workspace into `main`: with nothing left to push (**409** `unpushed_commits`) and `main` brought in cleanly, which a dry run of that merge confirms (**409** `bring_in_first` with the dry run's `conflicts` and `violations` otherwise), the remote merges the workspace into `main` with the person's message, which needs a maintainer of `main` there (the remote's **403** `forbidden`, `permission: "merge"`, `branch: "main"`, as given; ADR-0068 decision 4). Body: `{ "message", "deleteWorkspace"?: true }`. With `deleteWorkspace`, the branch is deleted on the remote (allowed, since `main` holds its head) and the local branch and the records here are removed; otherwise the workspace is kept and can go on. Response: `{ workspace, delivered: { commit, base, source, target, upToDate }, deleted }`.

---

## Error codes

| Status | Code | Meaning |
|---|---|---|
| 400 | `bad_request` | The body is not the expected JSON shape |
| 400 | `message_required` | A write has no `message` |
| 400 | `invalid_document` | A document fails its shape check (see `issues`) |
| 400 | `invalid_type` | The type cannot be written through the document routes |
| 400 | `id_mismatch`, `type_mismatch` | The body's `@id` or `@type` disagrees with the path |
| 400 | `duplicate_id`, `duplicate_capture` | The same identifier or capture twice in one batch |
| 400 | `bad_id` | An identifier that does not begin with its type, or an identifier on a type that derives its own |
| 400 | `unknown_field` | A filter or user field the type does not have |
| 400 | `ambiguous_ref`, `branch_required`, `write_at_commit` | Misused `branch` / `ref` parameters |
| 400 | `unsupported_version` | `Armature-Version` names a revision this hub does not serve (older, unknown, or newer on a write); `requested`, `supported` (ADR-0059) |
| 400 | `unsupported_capability` | `Armature-Capabilities` names a feature this hub lacks; `unsupported`, `supported` (ADR-0059) |
| 400 | `bad_if_match`, `bad_query`, `range_required`, `since_required` | Malformed headers or query parameters, `If-Match: *` among them |
| 400 | `not_an_ancestor` | A `since` commit the branch never held |
| 400 | `bad_name`, `protected_branch` | Branch name or `main` protection |
| 400 | `untraceable_type`, `users_live_on_main`, `person_filter_refused`, `unknown_profile`, `unknown_slice` | Route-specific refusals |
| 400 | `grants_live_on_main` | A `Grant` written to any branch but `main` (rule 21) |
| 400 | `reserved_trailer` | A message carrying `Armature-On-Behalf-Of` or `Armature-Relayed-By`, which the hub writes itself (Write envelopes) |
| 400 | `not_an_agent`, `not_a_person` | `Armature-Agent` names a person, or `Armature-User` names an agent beside it (Identity) |
| 400 | `remote_only` | A route or a write a workspace hub leaves to its remote (Discovery: `role`) |
| 400 | `workspace_only` | A workspace route on a remote hub (Workspace) |
| 401 | `identity_required`, `unknown_user`, `unknown_agent` | No identity, an unregistered one (a service's unregistered agent included), or an unregistered agent in `Armature-Agent`; under `oidc` with `WWW-Authenticate: Bearer` |
| 401 | `invalid_token` | Under `oidc`, a bearer token the hub refuses; `reason` says why (Identity; since 2026-11-05) |
| 403 | `forbidden` | The identity may not do this; `permission` and, as it applies, `branch`, `role` or `agent` (Grants; ADR-0068), or `permission: list_users`, the list of everyone registered, kept for maintainers of `main` and administrators under `oidc` (since 2026-11-05); `credential`, an agent as the credential itself on a remote hub (ADR-0067 decision 10); `owner`, anyone but the owner on a workspace hub, where `permission` may also be `push`, `bring-in` or `deliver` (Workspace); `reason: local_token`, a write to a workspace hub without its `Armature-Local-Token` (Identity), or `reason: program_action`, push, bring in or deliver called as a route on a workspace hub that serves them as the program's own actions (Workspace); both since 2026-11-03; `reason: relay` with `relayed`, a relay the hub refuses: `Armature-User` beside a person's token, a service without a `Relay` grant, a person or a branch the grant does not cover, an action other than a document write, or `Armature-Agent` beside it (Identity; since 2026-11-05) |
| 403 | `not_registered` | Under `oidc`, a valid token for a person the instance has not registered and does not admit on first sign-in (Identity; since 2026-11-05) |
| 403 | `forbidden` with `reason: remote_identity` | On a workspace hub reaching a remote under `oidc`: the remote resolves this hub's token to someone other than the workspace's owner, named in `credential` and `owner` (Workspace; since 2026-11-05) |
| 403 | `host_not_allowed`, `origin_not_allowed` | A host name or a web origin this hub does not serve (Hosts and web origins) |
| 404 | `not_found`, `unknown_type`, `unknown_ref` | No such document, type, branch or commit; on a workspace hub `unknown_ref` carries `remote_needed: true` when the commit may be the remote's and the remote could not be reached (Workspace) |
| 409 | `type_conflict` | An identifier held by another type (rule 12) |
| 409 | `user_exists`, `branch_exists` | Already registered or created |
| 409 | `merge_conflict`, `no_common_ancestor` | The merge cannot proceed |
| 409 | `unmerged_branch`, `branch_moved` | Branch deletion refused; `branch_moved` also a write whose branch moved under each of its three runs (The write pipeline), or a merge whose target moved during its check (Branches: merge) |
| 409 | `document_moved` | A write without `If-Match` lost its race to a commit that changed a document it replaces; `documents`, `checked`, `current` (Optimistic concurrency) |
| 409 | `registration_conflict` | Concurrent user registration; retry |
| 409 | `push_in_progress` | A push of the same workspace is already running on this hub (Workspace) |
| 409 | `unpushed_commits`, `bring_in_first` | A bring-in or delivery with local commits not yet pushed; a delivery before `main` was brought in cleanly, with the dry run's `conflicts` and `violations` (Workspace) |
| 409 | `workspace_exists` | A workspace this hub already holds (Workspace) |
| 412 | `precondition_failed` | The branch moved since the commit in `If-Match` |
| 413 | `body_too_large` | A request body over 10 MiB |
| 422 | `invariant_violation` | One or more rules broken (see `violations`), by a write or by the state a merge would make (Branches: merge) |
| 422 | `group_too_large` | A local commit holds a group of documents naming each other that no one request can carry (Workspace: push) |
| 500 | `store_unavailable` | The database rejected the configured credentials |
| 500 | `store_error`, `internal_error` | An unexpected database or server error (details in the server log only) |
| 500 | `history_too_long` | A history longer than the 5,000 commits the hub walks (the changes route, a merge, a branch delete) |
| 502 | `remote_unreachable`, `remote_error` | A workspace hub could not reach its remote, or the remote answered without what the hub needed (Workspace); `reason: etag_altered` when the remote's `ETag` is not a commit identifier, a proxy having altered it (since 2026-11-05) |
| 503 | `branch_busy` | A document's history could not be read at one head; `Retry-After` |
| 503 | `store_unreadable` | A file of a workspace hub's folder could not be read on this machine although it is there, such as one a sync service has made cloud-only while the service is stopped or the machine offline; `path` names it, `Retry-After`, and the hub reads the folder again on the next request (since 2026-11-03) |
| 503 | `store_unwritable` | A file of a workspace hub's folder could not be replaced because another program held it (a sync client under Windows refusing the rename) for longer than the hub's retries, about 2.5 seconds; `path` names it, `Retry-After`; the old file stands, nothing is lost, and the request can be sent again (since 2026-11-03) |
| 503 | `issuer_unreachable` | Under `oidc`, the identity provider's keys could not be read; the hub tries again on the next request (since 2026-11-05) |
| 504 | `store_timeout` | The database did not answer within the hub's 30-second deadline; a write may have landed, so re-read before retrying |
