# ADR-0016: Key Strategy for Documents and Junctions

## Status
Proposed

## Context

Armature uses two key strategies. Only one is declared in the schema, neither is documented, and one type follows neither correctly.

### Junction documents use Hash keys over their endpoint references

Seven of the eight Hash-keyed types key on nothing but references:

| Type | `@key` fields |
|---|---|
| NeedEvidenceLink | need, evidence |
| PrerequisiteRecord | objective, prerequisite |
| ItemInstance | assessment, implements |
| ActivityGroupMember | group, activity |
| ModuleObjective | module, references |
| ModuleActivityLink | module, activity |
| ModuleActivityGroupLink | module, group |

This does real work. It makes relationship uniqueness a **schema-level guarantee**: two `ModuleObjective` records cannot exist for the same (module, objective) pair, and the same item cannot be placed twice in one assessment. Given ADR-0006's theme — that constraints TerminusDB cannot express fall to the API — it is worth recording that this class of constraint *is* enforced by the store. Hash keys also make inserts idempotent, which matters for seeding and migration.

The only written trace of this reasoning is incidental, in ADR-0011: one-ended relationships "complicate `@key` generation on the record," and `PrerequisiteRecord`'s key "uses `["objective", "prerequisite"]` cleanly, with no ambiguity from null values."

### Primary artifacts declare no key at all

Fifteen types — `Course`, `Module`, `LearningObjective`, `AssessmentItem`, `Assessment`, `LearningNeed`, `DesignNote`, `User` and the rest — declare no `@key`.

`scripts/seed_data.js` supplies explicit `@id` values of the form `Course/intro-ai-for-ids`, with the comment "Explicit @id values let us reference documents before they exist in the DB." The API does not: `POST /api/courses` calls `addDocument` with no `@id` and leaves TerminusDB to assign one.

Two identifier conventions therefore coexist in the same database, and no document states which is intended.

### Response is keyed incorrectly

`Response` is not a junction. It is a child artifact holding a back-reference to its parent (ADR-0004). Its key is `["item", "label"]` — one reference and one content field.

Because siblings share `item`, `label` was drafted into service as a sibling discriminator. That is why the seed data carries positional markers ("A", "B", "C", "D") rather than answer text, and why option content has no home anywhere in the schema: `description` is unset on all 24 seeded responses, and correct answers carry no content at all.

Hash keys make their fields **immutable by identity** — editing a keyed field yields a different document with a different `@id`. Content fields are mutable by definition. The two are incompatible.

## Decision

**1. Junction documents keep Hash keys over their endpoint references.** This is confirmed as deliberate rather than incidental. The uniqueness guarantee is a feature, and endpoint references are stable: changing an endpoint does not mutate a relationship, it produces a different relationship.

**2. No key may include a mutable field.** Any field a user can edit — content, labels, sequences, rationale, status — is disqualified from participating in an identity scheme. Keys are built from references, or they are opaque. This rule generalises: it forbids a future `Ordering` sequence field, a review status, or any content field from entering a key.

**3. `Response.@key` is replaced with `Random`.** `Response` is a child artifact, not a junction, and needs no composite identity. `label` resumes its `ArmatureDocument` meaning as the human-readable content of the answer option.

**4. Primary artifacts declare `Random` explicitly** rather than omitting `@key`. The behaviour when `@key` is absent is not stated in the vendored TerminusDB reference, and relying on an undocumented default is not a decision.

**5. Identifier assignment is an API responsibility with a single convention.** Readable identifiers of the form `Type/slug` are a convenience of the seed script, not a schema-derived property. The API must either adopt that convention deliberately for every create, or accept store-assigned identifiers everywhere. It may not continue doing one in seeding and the other at runtime.

*Recommended:* store-assigned opaque identifiers, with readable slugs treated as an API-level display concern. This keeps identifiers stable when labels change and avoids slug-collision handling. Recorded as the weakest part of this ADR — it is the one decision here driven by consistency rather than by a demonstrated failure.

## Consequences

**Positive**

- The junction uniqueness guarantee becomes documented rather than folklore, so new types inherit the reasoning rather than rediscovering it.
- Editing an answer option no longer changes its identity. This is a precondition for any authoring tool, and for anchoring design rationale to a specific option.
- Option content gets a home without adding a field.
- The mutable-field rule gives future schema changes a clear test.

**Negative**

- Schema change to `Response`, requiring `npm run generate:types` and a paired commit.
- All 24 seeded responses need real option text backfilled. `docs/demo-api.md`'s item example currently returns no option text and needs updating.
- Existing `Response` documents in a loaded instance will receive different identifiers. At this stage that is a reload, not a migration.
- The implicit "no two identical options within one item" constraint moves from the key to API validation, following ADR-0006.

**Neutral**

- Declaring `Random` on primary artifacts formalises current behaviour rather than changing it, unless decision 5 selects readable identifiers.

## Verification

Before applying decision 4, confirm what TerminusDB does when `@key` is absent, and confirm that `POST /api/courses` against a local instance returns a store-assigned identifier. Same gating discipline ADR-0013 applied to `@min_cardinality` — verify the platform behaviour before encoding a decision that depends on it.

## Related

- ADR-0004 — back-references on children; why `Response` holds the foreign key to `AssessmentItem`
- ADR-0006 — constraints enforced by the API rather than the schema
- ADR-0011 — the only prior mention of `@key` generation, incidental to its main subject
