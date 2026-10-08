# ADR-0032: Identity resolution

## Status

Accepted (2026-10-08, merged in PR #7). Implements the boundary ADR-0015 drew between the external auth system, the store's access
control and the Armature `User`. Replaces the interim `Armature-User` mechanism ADR-0025
decision 2 and ADR-0055 anticipated. Verified against TerminusDB v12.0.7 by
`scripts/platform_checks.js` check W, results in §Verification.

Numbering note: 0032 is the number `docs/development-plan.md` §5 reserved for this decision.

## Context

ADR-0015 decided what a `User` is (a participant in the design process, a domain document that
travels with the graph) and where the line falls: an external system authenticates, the store
controls database access, and the hub resolves an authenticated identity to a `User` document and
writes it into `createdBy`. It left the resolution itself to the API, "creating one on first
encounter".

ADR-0025 made the commit the unit of process data: every write is a commit whose author is the
resolved `User`'s id. Phase 2 shipped an interim resolution in `app/lib/api/identity.ts`: the
caller names a `User` document id in an `Armature-User` header, the hub checks the document exists
on the branch being written and is a `User`, and uses the id as author. That trusts the caller,
which ADR-0025 accepted only while the demo has no auth and the mutating routes stay local.

Phase 3 adds the generic write path and the invariants engine, which set `createdBy` on every
`ArmatureDocument` the hub creates. Three things have to be decided before that code exists.

**How an identity reaches the hub.** The plan asks for a pluggable resolver: a trusted header for
local and demo use, OIDC later. Whatever the mechanism, the routes must see one shape.

**Where `User` documents live across branches.** The commit author is a free string the store
records without checking, so it is reliable on any branch. `createdBy` is a reference, and the
store rejects a reference to a document that is not on the branch being written (check L3). A
`User` created on `main` after a branch forked is absent from that branch, so a write there that
sets `createdBy` fails unless the hub does something. And a `User` created independently on two
branches would merge into two documents for one identity, or conflict.

**Who may be a `User`, and how the first one appears.** CoQui's ask O-R is "read users, and
create one" for a new reviewer. The AI design assistant reference client needs agent provenance:
a proposal written by a tool must be attributable to that tool, through the same write path as a
human (plan §1 P5). Under a trusted header there is no auth system to supply a display name, so
"create on first encounter" cannot produce a complete `User` without one.

What the store does, reproduced on 2026-10-08 in a scratch database (check letters refer to
`scripts/platform_checks.js`):

- A document can be found by a field value through the HTTP document API: a `POST` to the
  document path with `X-HTTP-Method-Override: GET` and a body `{ type, as_list, query }` returns
  the documents of that type whose fields match the template, with the data-version header, and an
  empty list when nothing matches (W1, W1c). This is the client's `getDocument({ query })` in
  HTTP form. The hub can therefore resolve `externalId → User` without a WOQL query.
- When both sides of a merge inserted the same document with the same id and the same fields,
  `apply` succeeds and creates no commit on the target, since the patch is empty (W2, W2b).
- When both sides inserted the same id with different fields, `apply` reports a 409 conflict with
  a witness of a new shape, `{ "@op": "InsertConflict", "@id_already_exists": "<iri>" }`, not the
  per-field `@expected`/`@found` witness of a changed value (W2d; compare P4).
- One write request can carry a list: `POST` of a list whose second document references the first
  commits both at once, and `PUT` with `create=true` and a list upserts an unchanged existing
  document beside a new one in one commit (W3, W3b, W3c).

## Decision

1. **The hub resolves identity; it never authenticates.** A request's identity is a set of
   claims, `{ externalId, displayName?, email?, institution? }`, produced by a resolver. The
   resolver is pluggable and chosen by the `ARMATURE_IDENTITY` environment variable. `header`,
   the default, reads `Armature-User: <externalId>` and trusts the caller, as the interim
   mechanism did, and is for local and demo use only. `oidc` is the named next resolver: a bearer
   token whose `sub` is the `externalId`, with `name` and `email` as the other claims; it is not
   built in Phase 3, but the claims shape is fixed now so that adding it changes no route. The
   routes call one function and never see the mechanism. The header now carries the identity the
   auth system would supply, the `externalId`, not a `User` document id, because the header stands
   in for the auth system. The two limits ADR-0025 placed on the interim header apply to the
   `header` resolver: the mutating routes stay local while it is the configured resolver.

2. **`main` is the registry of record for `User` documents.** Resolution looks the `externalId`
   up on `main` by template query (W1), whatever branch the request is reading or writing. One
   `externalId` maps to one `User` on `main`; the hub enforces this, since the store cannot. `User`
   documents are created only on `main`: `POST /api/v1/users` refuses a `branch` or `ref`
   parameter with 400. This is what keeps one identity from becoming two documents at merge time
   (W2d). Branches hold copies of `main`'s `User` documents, placed there by decision 4, never
   originals.

3. **First encounter creates a `User` on `main` when the claims can complete one.** A `User`
   needs a `displayName`. When the resolved claims carry one and no `User` has that
   `externalId`, the hub inserts one on `main` under a hub-minted random id, `User/<uuid>`,
   authored by the new `User` itself, with the message `Register <externalId> on first
   encounter`. The hub mints rather than letting the store mint because the registering commit's
   author is the new `User`, whose id must be known before the insert; the id is opaque either
   way (ADR-0024 decision 2). When the claims carry no `displayName`, resolution
   fails with 401 `unknown_user` and the `User` is created explicitly with `POST /api/v1/users`.
   The `header` resolver yields only an `externalId`, so under it every `User` is created
   explicitly, which is CoQui's O-R flow: a human registers the new reviewer, then the reviewer
   writes. A deployment's first `User` arrives through the seed or an administrative script,
   outside the plugin API, the same category ADR-0024 decision 5 gives deletion. The insert uses
   `If-Match` on the `main` head the lookup read, so two concurrent first encounters cannot both
   register; the loser re-resolves and finds the winner's document.

4. **Author and `createdBy` come from the resolved identity, never from the body.** The commit
   author is the resolved `User`'s id (ADR-0025 decision 2, unchanged). For every class that
   inherits `ArmatureDocument`, the hub sets `createdBy` to the resolved `User` when it creates
   the document and preserves the stored value when it replaces one; a `createdBy` in the body is
   ignored in both cases rather than rejected, so a document read from the hub can be written back
   unchanged. Which classes inherit `ArmatureDocument` is read at runtime from `CLASS_ANCESTORS`,
   which `scripts/generate-types.js` now emits from `schema.json` beside `CLASS_CATEGORY`; the
   same map serves the invariants engine's reference-class check (CLAUDE.md constraint 0), where
   a reference is valid when the target's class is the declared class or has it as an ancestor.
   Category is not a proxy: `PrerequisiteRecord` is a relationship that inherits
   `ArmatureDocument` and carries `createdBy`.

5. **A write that references a `User` the branch lacks carries `main`'s copy in the same
   commit.** When the hub is about to set `createdBy` on a branch other than `main` and the
   resolved `User` is not on that branch, it includes `main`'s `User` document in the write as a
   list `PUT` with `create` (W3b), so the artifact and the `User` land in one commit and the
   reference is valid. The copy is identical to `main`'s, so merging the branch back adds nothing
   and conflicts with nothing (W2, W2b). The branch's history shows the `User` arriving in the
   commit that first needed it, which is the truth. A commit author needs no copy, since the store
   does not check authors; a relationship document with no `createdBy` needs none either.

6. **Users routes.** `GET /api/v1/users` lists the `User` documents at a ref (`?branch=` or
   `?ref=`, `main` by default, `ETag` as every read). `GET /api/v1/users/me` returns the `User`
   the request resolved to, or the resolver's 401; every client needs "who am I", and under the
   `header` resolver it is how a client learns which document its `externalId` names.
   `POST /api/v1/users` creates one on `main` from the envelope `{ message, user }`, where `user`
   carries `displayName`, `externalId` and optionally `email`, `institution` and a client-supplied
   `@id` (ADR-0024); it answers 201 with the id and the commit, 409 `user_exists` when the
   `externalId` is already registered, and 409 `type_conflict` when the id is held by another
   type. One document by id is the generic `GET /api/v1/documents/User/:id`. There is no `User`
   edit or delete route in this phase: editing a `User` waits for a client that needs it, and will
   have to re-carry the edited copy to branches that hold the old one, since a differing copy
   conflicts at merge (W2d); deletion is administrative (ADR-0015 consequences, ADR-0024
   decision 5).

7. **Agent users are ordinary `User` documents.** An agent's `externalId` begins with `agent:`,
   followed by the tool and an optional instance, `agent:coqui/item-drafter`; its `displayName`
   names the tool; it has no `email`; `institution` may name the operating organisation. Agents
   are registered with `POST /api/v1/users` by a person and are never created on first encounter,
   since an agent's credentials carry no `name` claim. An agent writes through the same routes
   under the same constraints as a person, and its commits carry its id as author. Acting on
   someone's behalf is not modelled: the delegation trailers ADR-0025 reserved wait for the AI
   design assistant to become real (plan §6, "AI provenance beyond `createdBy`").

8. **Error codes are unchanged.** 401 `identity_required` when the resolver yields no claims;
   401 `unknown_user` when the claims name no registered `User` and cannot create one. The
   merge route learns the `InsertConflict` witness (W2d) and reports it as a conflict entry with
   the document id and `op: "InsertConflict"` and no field, since ADR-0024's client-supplied ids
   make a same-id, different-content insert on two branches possible for any type.

## Consequences

- The `Armature-User` header changes meaning from a `User` id to an `externalId`. The seed's
  `User/demo-designer` has `externalId` `demo-designer@example.edu`, which the tests and any
  local client now send. CoQui's `httpHub` sends the header; it changes one constant when it picks
  up Phase 3.
- `createdBy` is now set, on every `ArmatureDocument` the hub creates. The seed's documents have
  none and keep none: a replace preserves the absence, because recording the first editor as the
  creator would be false.
- A branch's `changes?since=` may list a `User` insert that is a carried copy. That is accurate:
  the branch's graph gained the document in that commit.
- Resolution costs one template query on `main` per write, and one more read on the target branch
  when `createdBy` is set off `main`. At demo scale this is nothing; a per-request cache is the
  first optimisation if it matters.
- The store adapter (ADR-0055) gains `queryDocuments` (the method-override form, W1),
  `insertDocument` (insert semantics: the store rejects an existing id, which is what makes
  registration race-safe) and `putDocuments` (a list in one commit, W3b). `deleteDocument` is added for administrative use and tests only; no
  route calls it.
- Tests that exercise `POST /users` write to `main`, because that is where users live, and delete
  what they created through the adapter. This is the one exception to "tests never touch `main`";
  the seed is untouched and the commits are reversible history, as ADR-0025 decision 6 requires.
- ADR-0015's "creating one on first encounter" is narrowed to "when the claims carry a
  `displayName`"; its consequences on `User` deletion stand. ADR-0025 decision 2's interim
  paragraph is done. ADR-0054's middleware slot for identity is a function the write routes call,
  for the same reason the data-version token is: the registry read and the carry depend on the
  resolved ref, which is known only inside the route.
- Deferred, each with its trigger: the `oidc` resolver, when a deployment leaves the local demo;
  `User` edits, when a client needs to change a display name; a `kind` or role on `User`, when a
  second client needs more than the `agent:` convention (plan §6); delegation, with the AI design
  assistant.

## Verification

`scripts/platform_checks.js` check W, run on 2026-10-08 against `terminusdb/terminusdb-server:v12.0.7`.

| Check | Result | Finding |
|---|---|---|
| W1 | PASS | `POST` + `X-HTTP-Method-Override: GET` with `{ type, as_list, query }` returns the matching documents and the data-version header |
| W1c | PASS | The same query with no match returns `[]` |
| W1d | PASS | `@type` inside the template, with no `type` field, also works |
| W2 | PASS | `apply` of a branch commit that inserted a document the target already holds, same id and fields: success |
| W2b | INFO | The target head is unchanged: an empty patch makes no commit |
| W2c | PASS | The document on the target is intact afterwards |
| W2d | PASS | Same id inserted on both sides with different fields: 409, witness `{ "@op": "InsertConflict", "@id_already_exists": "<iri>" }` |
| W3 | PASS | `POST` of a list whose second document references the first: one commit |
| W3b | PASS | `PUT` with `create=true` and a list of one unchanged existing and one new document: one commit |
| W3c | PASS | The new document's reference resolves afterwards |

## Related

ADR-0015 (the boundary this implements), ADR-0024 (client-supplied ids, store-minted ids, deletion
as administrative), ADR-0025 (author and reason on every commit; the interim header; merge
witnesses), ADR-0027 (schema self-description; `CLASS_ANCESTORS` joins `CLASS_CATEGORY`),
ADR-0054 (identity as a concern of the write routes), ADR-0055 (the adapter methods this adds).
