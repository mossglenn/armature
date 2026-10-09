# Armature API reference

This document describes every route of the Armature API (application programming interface) as built at the end of Phase 4 (8 October 2026). The code is the authority: routes are defined in `app/lib/api/routes/`, conventions in `app/lib/api/http.ts`, and error mapping in `app/lib/api/app.ts`. For the reasoning behind the design, see [How Armature Works](how-armature-works.md) Part III and the Architecture Decision Records (ADRs) cited below.

## Conventions

### Base path and versioning

Every route is under `/api/v1`. The version segment is part of the contract; a change that would break existing clients goes under a new version (ADR-0026). When the app runs locally the full address is `http://localhost:3000/api/v1/...`.

### Reading at a ref

Every read happens at a **ref**, a named state of the design:

- `?branch=<name>` reads the latest commit of a branch (default: `main`);
- `?ref=<commit-id>` reads the design exactly as it was at that commit (read-only).

Passing both is a 400 (`ambiguous_ref`). A commit identifier that does not exist is a 404 (`unknown_ref`). Writes always go to a branch; `?ref=` on a write is a 400 (`write_at_commit`).

### The commit in every response: `ETag`

Every response that read from or wrote to the database carries the commit it was served from or created, as a standard `ETag` header holding a bare commit identifier: `ETag: "<commit-id>"`. (ADR-0025 decision 7. TerminusDB's own version header never appears in this API.)

### Optimistic concurrency: `If-Match`

A write may send `If-Match: "<commit-id>"`, meaning "apply this only if the branch is still at this commit." If anyone has committed to the branch since, the write is refused with **412** (`precondition_failed`), and the body carries `expected` and `current` commit identifiers. The token is the branch head, not a fingerprint of one document, so a 412 may mean someone changed a different document; re-read and retry. Without `If-Match`, writes are unconditional. `If-None-Match` is not supported.

### Identity: `Armature-User`

Every route that changes data needs an identity (ADR-0032). Under the default `header` resolver, the request carries `Armature-User: <externalId>`, the external identifier of a registered `User` (the seed registers `demo-designer@example.edu`). The hub resolves it to a `User` document on `main`, records that user as the commit author, and sets `createdBy` on documents it creates. Missing header: **401** `identity_required`. Unregistered identifier: **401** `unknown_user`.

The `header` resolver trusts the caller. Do not expose routes that change data beyond the local machine while it is configured. An `oidc` (OpenID Connect) resolver is named but not built.

### Write envelopes

Every write body is a JSON object with a required, non-empty `message`: the reason for the change, stored as the commit message. A write without one is a **400** `message_required`. The other fields depend on the route: `{ message, document }`, `{ message, documents }`, `{ message, from }`, `{ message, user }`. Branch creation is not a commit and takes `{ name, from }` with no message.

### Document identifiers

A document's identifier is `Type/local-part`, such as `LearningObjective/distinguish-ai-approaches`. In route paths the type and local part are separate segments: `/documents/LearningObjective/distinguish-ai-approaches`.

- **Artifacts** may be given an identifier by the client on first write; later writes under it replace the document (ADR-0024). Without one, the store mints one.
- **Relationship (junction) documents** derive their identifier from their key fields, so a client never supplies one; writing the same key fields again replaces the document. Supplying an `@id` on one is a 400 (`bad_id`).
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
| `<field>=<value>` | Keep documents whose field equals the value. Numbers and `true`/`false` are converted for numeric and boolean fields |
| `count`, `skip` | Paging: at most `count` documents, after skipping `skip` |

Returns an array of documents. Unknown type: 404 `unknown_type`. A filter on a field the type does not have, or on an embedded part: 400 `unknown_field`.

> **Known limitation.** Filtering on a *required* reference field works (for example `/documents/Assessment?module=Module/how-ai-works`). Filtering on an *optional* or *multi-valued* reference field (for example `?createdBy=`, `?generatedBy=`, `?assesses=`) is passed to the database, which answers such a query with an internal error (platform check Y), so the route returns 500. The intelligence reads work around this internally; the list route does not yet. Filter in the client for now.

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

Response: `{ id, branch, start, count, entries: [ { commit, author, message, timestamp, diff } ] }`. Lists inside a document (such as an item's options) are compared by position, so reordering reads as several changes.

### `GET /documents/:type/:id/diff?from=<commit>&to=<commit>`

The structural difference in one document between two commits. Both are required (400 `range_required`) and must exist (404 `unknown_ref`). Response: `{ id, from, to, diff }`.

### The write pipeline

`PUT /documents/:type/:id` and `POST /documents` run the same steps (`app/lib/api/write.ts`):

1. **Shape.** Each document is checked against a validation schema generated from `schema/schema.json`: required fields, field kinds, allowed enum values, minimum set sizes, no unknown fields, every string non-empty and at most 10,000 characters. Failure: **400** `invalid_document` with an `issues` list (`{ index, path, message }` per problem).
2. **Identity of the document.** An identifier held by another type: **409** `type_conflict`. An existing document (found by `@id`, or for a junction by its key fields) makes this write a replace.
3. **Provenance.** `createdBy` is set to the resolved user on create and preserved on replace (a value in the body is ignored). On a branch that lacks the user's `User` document, a copy from `main` is written in the same commit.
4. **Rules.** Every invariant is checked against the branch as it will be after the write. Failure: **422** `invariant_violation` with every violation at once, as `violations: [ { code, id?, index, field?, message } ]`.
5. **One commit**, authored by the resolved user with the request's message, honoring `If-Match` (**412** when the branch has moved).

The rules, numbered as in `.claude/CLAUDE.md`:

| # | Rule | Violation code |
|---|---|---|
| 0 | Every reference names an existing document of the declared class or a subclass | `unknown_reference`, `unknown_capture`, `reference_class` |
| 1, 2 | `AssessmentItem.assesses` and `LearningActivity.targets` have at least one objective | 400 `invalid_document` (shape) |
| 3 | Module content positions are unique across activity links and group links in a module | `duplicate_sequence` |
| 4 | Group member positions are unique within a group | `duplicate_sequence` |
| 5 | Item positions are unique within an assessment | `duplicate_sequence` |
| 6 | Activity groups are flat | follows from rule 0 |
| 7 | Coverage is never stored | nothing to check; the schema has no coverage field |
| 8 | `fragmentId` is unique across an item's stem, options and feedback | `duplicate_fragment_id` |
| 9 | Option text is unique within an item; option count and number of correct options suit the item type | `duplicate_option_text`, `option_count`, `correct_option_count` |
| 10 | A placement is not `Approved` while its item is `Draft` or `InReview`, in either direction | `instance_ahead_of_item` |
| 11 | A `Dismissed` finding has a `resolutionRationale` | `rationale_required` |
| 12 | An identifier is not reused across types | 409 `type_conflict` |

There is no route that deletes a document. Lifecycle changes are status changes (`ItemStatus.Retired`, `FindingStatus.Dismissed`, `ObjectiveState.Archived`), which keep every reference and every line of history; deletion is an administrative operation outside the API (ADR-0024 decision 5).

---

## Branches

### `GET /branches`

Every branch with its latest commit: `[ { name, head: { commit, author, message, timestamp, metadata? } } ]`.

### `POST /branches`

Creates a branch. Body: `{ "name": "...", "from": { "branch": "main" } }` or `{ "name": "...", "from": { "commit": "<commit-id>" } }`; `from` defaults to `main`. Names must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$` (400 `bad_name`). An existing name: 409 `branch_exists`. Response **201**: `{ name, from, head }`. Branch creation is not a commit and needs no identity.

### `GET /branches/:name`

The branch's latest commit: `{ name, head }`, with the commit in `ETag`.

### `POST /branches/:name/merge`

Merges another branch into `:name` with the database's three-way merge (ADR-0025 decision 5).

- Headers: `Armature-User` (required).
- Body: `{ "message": "...", "from": "<source branch>" }`.
- Success: `{ commit, base, source, target, upToDate: false }`. The merge commit records the merged source commit in its metadata (`armature.mergeSource`).
- Already merged: `{ commit: <target head>, base, source, target, upToDate: true }`, with no new commit.
- No shared history: 409 `no_common_ancestor`.
- Conflict: **409** `merge_conflict` with `{ base, source, target, conflicts }`. Each conflict is either `{ id, field, base, target, source }` (both sides changed a field; the three values) or `{ id, op: "InsertConflict" }` (both sides created the same identifier with different content). Nothing is resolved automatically; the target branch is unchanged.

### `GET /branches/:name/changes?since=<commit>`

The documents inserted, deleted or updated on the branch since a commit: `{ branch, from, to, changes: [ { id, op } ] }` where `op` is `insert`, `delete` or `update`.

### `DELETE /branches/:name`

Deletes a branch, under three rules (ADR-0025 decision 6, amended): `main` is never deleted (400 `protected_branch`); a branch is deleted only when another branch already holds its latest commit (otherwise 409 `unmerged_branch` with its `head`); there is no force option. Headers: `Armature-User` (required), `If-Match` (optional; 412 if the branch moved). If a commit lands during the check: 409 `branch_moved`. Response: `{ deleted, head, heldBy }`.

There are no reset, squash or rebase routes: shared history is never rewritten.

---

## Users

### `GET /users`

Every `User` at a ref (`main` by default).

### `GET /users/me`

The `User` this request resolves to, or the resolver's 401.

### `POST /users`

Registers a user on `main`, the registry of record (ADR-0032). A `branch` or `ref` parameter is refused (400 `users_live_on_main`). The caller must be a registered user.

- Body: `{ "message": "...", "user": { "displayName": "...", "externalId": "...", "email"?: "...", "institution"?: "...", "@id"?: "User/<id>" } }`. Unknown fields: 400 `unknown_field`.
- Response **201**: `{ id, commit }`.
- An `externalId` already registered: 409 `user_exists` (with its `id`). An `@id` held by another type: 409 `type_conflict`.

AI agents are ordinary users whose `externalId` begins with `agent:` (for example `agent:coqui/item-drafter`), registered by a person. There are no routes to edit or delete a user.

---

## Design intelligence

All four reads compute their answers from the graph at the requested ref; nothing they report is stored (ADR-0056). Each accepts `?branch=` or `?ref=` and returns the commit in `ETag`.

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

Response: `{ scope, itemsBelowObjective: [ { item, objective, levelsBelow } ], objectivesWithoutItemAtLevel, objectivesWithoutActivity, unleveled: { objectives, items } }`. An item counts as reaching its objective when its level is the same or higher. Activities have no Bloom's level, so "without activity" means no activity targets the objective at all.

### `GET /intelligence/trace/:type/:id`

Walks the design lifecycle in both directions from one document:

```
evidence ← need-evidence link → need ← objective ← item ← placement → assessment ← dataset ← metric
```

with modules attached as context to every objective (through its declarations) and assessment reached. Accepted types: `LearningMetric`, `LearningDataset`, `Assessment`, `AssessmentItem`, `LearningObjective`, `LearningNeed`, `DescriptiveEvidence`, `Module`, `LearningActivity`. Any other type is a 400 `untraceable_type`.

Response: `{ root, nodes: [ summary ], edges: [ { from, to, via, through?, confidence?, status?, role? } ], annotations: [ design notes and findings about any node reached ] }`. `via` is the field followed; `through` is the junction document passed through, with its data.

### `GET /intelligence/impact/:type/:id`

Every document that references this one, found from the schema's reference fields: `{ document, summary: { references, byType }, references: [ { id, type, label, field, within? } ] }`. For a junction, `within` names what it sits in (the assessment a placement belongs to, the module a declaration is for).

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
| 400 | `bad_if_match`, `bad_query`, `range_required`, `since_required` | Malformed headers or query parameters |
| 400 | `bad_name`, `protected_branch` | Branch name or `main` protection |
| 400 | `untraceable_type`, `users_live_on_main` | Route-specific refusals |
| 401 | `identity_required`, `unknown_user` | No identity, or an unregistered one |
| 404 | `not_found`, `unknown_type`, `unknown_ref` | No such document, type, branch or commit |
| 409 | `type_conflict` | An identifier held by another type (rule 12) |
| 409 | `user_exists`, `branch_exists` | Already registered or created |
| 409 | `merge_conflict`, `no_common_ancestor` | The merge cannot proceed |
| 409 | `unmerged_branch`, `branch_moved` | Branch deletion refused |
| 409 | `registration_conflict` | Concurrent user registration; retry |
| 412 | `precondition_failed` | The branch moved since the commit in `If-Match` |
| 422 | `invariant_violation` | One or more rules broken (see `violations`) |
| 500 | `store_unavailable` | The database rejected the configured credentials |
| 500 | `store_error`, `internal_error` | An unexpected database or server error (details in the server log only) |
