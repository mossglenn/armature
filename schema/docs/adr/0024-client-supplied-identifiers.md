# ADR-0024: Client-Supplied Identifiers and Replace Semantics

> **In brief.** This decision answered: who chooses a record's identifier, and what happens when the
> same identifier is written twice? It decided that a client tool may choose the permanent identifier
> of any primary record on its first write (otherwise the database assigns one), that a later write
> under the same identifier replaces the record, that reusing an identifier for a different type of
> record is refused, and that tools never delete records but change their status instead. It still
> holds and is implemented, except one consequence it recorded: protecting fields that an older client
> cannot see from being lost when it replaces a record has not been built and remains open.

## Status
Accepted (2026-10-07). Resolves ADR-0016 decision 5 and the open question in ADR-0023.

**Note 2026-10-08:** implemented in Phase 3's generic write path (`app/lib/api/write.ts`);
decision 4 is constraint 12 (409 `type_conflict`). **Open:** the lossless-write requirement in
§Consequences (research candidate ADR-0035) was not implemented in Phase 3 and no phase of
`docs/development-plan.md` currently owns it.

## Context

Two identifier conventions have coexisted since the first seed: the seed script supplies readable
`Type/slug` ids on every document, while the API's `POST /courses` and `POST /modules` let the store
mint opaque ids. ADR-0016 decision 5 recorded this as the weakest decision in that ADR and
recommended store-assigned ids with slugs as a display concern, "driven by consistency rather than
by a demonstrated failure."

> **Later change (2026-10-08):** both routes were removed in Phase 3 with the other unversioned
> routes; every write now goes through the generic `/api/v1/documents` routes.

A demonstrated failure has since arrived from two directions.

**CoQui** authors items offline and needs to comment on an item and its parts before the item has
ever been sent to Armature (ADR-0023's open question). A store-minted id cannot exist before the
first write, so the authoring tool must be able to choose the item's permanent id, and the hub must
accept it. CoQui's outbox also retries pushes; with client ids and replace semantics a retried push
is the same push, and the lookup-then-insert race the handoff describes disappears.

**The reference clients** (plan §2) make it general: an outcomes importer loading results from an
LMS must be idempotent across re-runs, and a needs-analysis intake tool records evidence whose
identity is the external document, not a store sequence. Two clients beyond CoQui need the same
capability, so it enters the hub in generic form.

Platform behaviour, verified on TerminusDB v12.0.7 (`scripts/platform_checks.js`, check K): a class
with an explicit `@key` of type `Random` accepts a client-supplied `@id` on insert and mints one when
none is given; a second `POST` under an existing id is rejected with `api:DocumentIdAlreadyExists`;
`PUT` replaces under the same id. A `PUT` of a different `@type` under an existing id is rejected by
the store with an unhelpful prefix error, so the type check belongs in the hub.

The standards research (`docs/research/adr-candidates.md`, amendment to 0024) adds the lessons from
Torus, Adapt, OATutor and Twine: ids that are regenerated on import, derived from position, or
overflowed by a sequence all broke downstream references silently.

## Decision

1. **Every primary artifact declares `@key: { "@type": "Random" }` explicitly.** This formalises
   ADR-0016 decision 4 and is the key strategy under which the store accepts a supplied `@id`.
   Junction documents keep their `Hash` keys over endpoint references (ADR-0016 decision 1): their
   identity *is* the relationship, and a client never needs to name one in advance. Within a batch,
   a junction can still be referenced before it exists through the store's `@capture` and `@ref`
   (the seed does this to attach a `DesignNote` to a `ModuleObjective`).

2. **A client may supply `@id` on first write of any primary artifact.** The id is opaque to the
   hub: it is never parsed, never derived from a label, and never regenerated. A client that does
   not supply one gets a store-minted id back and must use it thereafter. Readable slugs are a
   client choice, not a convention; the seed's `Type/slug` ids are now a documented client choice.

3. **Later writes under the same id replace the document** (`PUT` semantics, ADR-0022's
   embedded parts included). Replace is the store's native operation and makes a retried write
   idempotent.

4. **A write whose id exists under a different `@type` is rejected with 409 by the hub**, before
   it reaches the store. The store rejects it too, but with an error about IRI prefixes; the hub
   turns it into a conflict a client can act on. Ids belong to one lineage for the life of the
   database.

5. **The hub never deletes a plugin-written document on a plugin's behalf.** Lifecycle changes
   are status changes (`ItemStatus.Retired`, `FindingStatus.Dismissed`, `ObjectiveState.Archived`),
   which preserve every reference and every line of history. Deletion is an administrative
   operation outside the plugin API.

6. **Keys never include mutable fields** (ADR-0016 decision 2), restated as still binding. `Hash`
   keys on junctions are over references, which do not change; `Random` keys on artifacts are over
   nothing.

## Consequences

**Positive**
- Pre-sync authoring works: a tool can mint an item id and its fragment ids (ADR-0023) before the
  first write, and comments made offline survive the first sync.
- Idempotent loads and retries: the same write twice is the same document once.
- One convention. The seed, the API and every client follow the same rule; ADR-0016's "two
  conventions coexist" complaint is closed.

**Negative / Neutral**
- Clients own id uniqueness. A UUID or ULID is the recommended form; a readable slug is allowed but
  collides if two clients choose the same one, at which point the 409 in decision 4 is the only
  guard (and only when the types differ). ADR-0047 (instance IRIs) is where cross-instance identity
  would be addressed if a second Armature instance ever exchanges documents with the first.

  > **Later change (2026-10-08):** ADR-0047 is a research candidate in
  > `docs/research/adr-candidates.md` (candidate ADR-0047), not a written ADR.

- Replace semantics with a growing schema is the lossy-write hazard the research names as
  ADR-0035: a client built against an older schema reads, edits and writes back a document without
  the fields it cannot see. Decision 3 is therefore paired with a requirement on Phase 3's write
  path: the hub carries forward fields the writing client's declared schema version could not see.
  That ADR is written with the write path; this one records the dependency.

  > **Later change (2026-10-08):** not done. Phase 3's write path shipped without carrying
  > forward unseen fields, and candidate ADR-0035 was not written. The hazard is open; no phase
  > currently owns it.

- The hub's 409 check costs one read per write. Acceptable; it also serves the type-mismatch and
  optimistic-concurrency checks Phase 2 and 3 add.

## Related
- ADR-0016 — key strategy; decisions 1, 2, 4 retained, decision 5 resolved here
- ADR-0022, ADR-0023 — embedded parts and `fragmentId`; the pre-sync case
- ADR-0035 (candidate) — lossless writes across schema versions; required by decision 3
- `docs/development-plan.md` §2 (reference clients), Phase 3 (the write path)
