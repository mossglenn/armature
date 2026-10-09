# ADR-0012: DesignNote for Free-Form Rationale Capture

> **In brief.** Many design decisions do not fit any existing rationale field, so they get lost in
> meeting notes or in someone's memory. This decision added `DesignNote`: a free-text explanation
> that can be attached to one or more records anywhere in the graph, with an optional category. It
> still holds. What a note may be attached to was tightened twice: first to any named artifact
> (ADR-0014), then to any design record, artifact or relationship, but never a user account
> (ADR-0017). (ADR stands for Architecture Decision Record.)

## Status
Accepted

**Amended by ADR-0014** (2026-02-26): `subject` retyped from `Set<xsd:anyURI>` to
`Set<ArmatureDocument>`. **Amended by ADR-0017** (2026-10-07): `subject` is `Set<DesignRecord>`; the
store checks that each subject exists, and the API checks its class (noted 2026-10-08).

## Context
Several document types in the schema carry dedicated rationale fields: `PrerequisiteRecord.rationale`, `LearningNeed.rationale`, `ModuleObjective.roleRationale`. These fields are appropriate for decisions made within a well-defined slot — the reason a specific prerequisite was identified, the reason a need was prioritized, the reason an objective was assigned a role.

But design decisions frequently don't fit neatly into a predefined field. A designer might need to record:
- Why a particular Bloom's level was chosen for an objective
- The reasoning behind an assessment strategy for a module
- Why a specific sequencing order was chosen
- A suspected prerequisite relationship where the specific prerequisite objective is not yet known (the `PrerequisiteIntent` case from ADR-0011)
- A trade-off considered and rejected during course design

These decisions are currently lost — they stay in meeting notes, Slack threads, or the designer's head. Armature's core value proposition is that design rationale is captured in the graph, not just the artifacts.

Two design questions arise:
1. Should free-form notes be attached to specific artifact types or be universal?
2. Should there be one rationale layer (free-form notes only) or two (notes + structured decisions)?

A type-specific approach (e.g., `ObjectiveNote`, `ModuleNote`) would require a new type per artifact, duplicating schema complexity. A universal type using `xsd:anyURI` subject references is more flexible and avoids combinatorial explosion.

For the two-layer question: `DesignNote` handles narrative rationale well. A more structured `DesignDecision` type — capturing alternatives considered, tradeoffs, and affected artifacts — would support richer design process analysis but requires concrete usage patterns to define well. Adding it prematurely risks the wrong abstraction.

## Decision
Add `DesignNote` as a universal free-form rationale type. Key design choices:

- `subject: Set<xsd:anyURI>` — references any document(s) in the graph by URI, enabling a single note to span multiple artifact types (e.g., a rationale connecting an objective, an assessment item, and a module decision)

**Update (ADR-0014):** `subject` has been retyped to `Set<ArmatureDocument>` with `@min_cardinality: 1`. The `xsd:anyURI` approach was a stopgap pending the `ArmatureDocument` base class. TerminusDB now enforces referential integrity natively. The API-layer validation and deletion handling questions raised in the Consequences section below are resolved by ADR-0014.

> **Later change (2026-10-08):** `subject` is now `Set<DesignRecord>` (ADR-0017), so a note can
> attach to a relationship as well as an artifact. TerminusDB checks only that each subject exists,
> not its class (platform check L, 2026-10-07); the API checks the class on every write (constraint
> 0, `app/lib/api/invariants/references.ts`, since Phase 3, 2026-10-08).
- `rationale: xsd:string` — markdown-capable text field for the free-form explanation
- `category: Optional<DesignNoteCategory>` — optional categorization using a controlled vocabulary (BloomsLevelChoice, AssessmentStrategyChoice, SequencingDecision, PrioritizationDecision, ScopeDecision, AlignmentDecision, PrerequisiteIntent, Other)
- API constraint: `subject` must contain at least one element — an orphaned note is not useful

  > **Later change (2026-10-08):** Enforced at schema level by `@min_cardinality: 1` (ADR-0014), and
  > by the generated request schema before the write reaches the store.

A `DesignDecision` structured type is explicitly deferred (see ADR-0010). A forward pointer field `relatesToDecision` is reserved on `DesignNote` as a comment in the schema documentation, not as a live field, to signal the intended migration path when that type is defined.

> **Note (2026-10-08):** The reservation is in the `DesignNote` class comment in
> `schema/schema.json`.

## Consequences
- Designers can capture rationale that falls outside predefined fields, closing the most common gap in design process documentation.
- `DesignNoteCategory` makes rationale queryable by decision type — "show all notes about Bloom's level choices" is a valid graph query.
- `PrerequisiteIntent` in the category enum provides a semantically clean home for suspected-but-unresolved prerequisite relationships, without polluting the prerequisite graph with incomplete edges (ADR-0011).
- The `xsd:anyURI` subject approach is flexible but bypasses TerminusDB's type system — subjects are not validated as real documents by the schema. API layer must validate that subject URIs resolve to existing documents.

  > **Later change (2026-10-08):** The `xsd:anyURI` approach was replaced (ADR-0014, then ADR-0017);
  > see the notes above.
- Deferring `DesignDecision` means usage patterns in `DesignNote.category` will inform what structure that type should have when the time comes — avoiding premature structuring.

## Related
ADR-0003 (reified relationships as first-class artifacts), ADR-0009 (semantic enrichments), ADR-0010 (intentionally deferred), ADR-0011 (placeholder objectives), ADR-0014 (subject retyped to `ArmatureDocument`), ADR-0017 (subject retyped to `DesignRecord`)
