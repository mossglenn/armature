# ADR-0014: ArmatureDocument Abstract Base Class

> **In brief.** Most named records in Armature (objectives, questions, modules, notes and so on)
> have a name and a description. This decision created one shared parent type, `ArmatureDocument`,
> that carries those fields once, so they are defined in one place and other records can point to
> "any named artifact." It still holds. Later decisions put a broader parent, `DesignRecord`, above
> it so that notes can also attach to relationships (ADR-0017), and corrected one claim: the
> database checks that a referenced record exists, not what type it is; Armature's application
> programming interface (API) checks the type. (ADR stands for Architecture Decision Record.)

## Status
Accepted. Amended 2026-10-07 by ADR-0017: `ArmatureDocument` now inherits `DesignRecord`, and
`DesignNote.subject` is typed `Set<DesignRecord>` rather than `Set<ArmatureDocument>`. One premise
of this ADR is corrected by ADR-0017's verification: TerminusDB v12.0.7 checks that a referenced
document exists, not that it has the declared class, so the "schema-enforced referential integrity"
gained by retyping `subject` from `xsd:anyURI` is existence, not type. Type is enforced by the API
(ADR-0006); the typing remains the documented contract and the generator's input.

**Amended by ADR-0022** (2026-10-07): `Response` leaves the inheritance list (marked in place
below). **Correction (2026-10-08):** ADR-0006, cited above for type enforcement, is superseded by
ADR-0013. Class enforcement is constraint 0 of the invariants engine
(`app/lib/api/invariants/references.ts`), on every write since Phase 3 (2026-10-08). This ADR amends
ADR-0001 (`label` and `description` move to `ArmatureDocument`) and ADR-0012 (`subject` retyped).

## Context
Thirteen primary artifact types in the schema independently declared `label: xsd:string` and `description: Optional<xsd:string>`. These fields are structurally identical across all types — every named artifact in the Armature graph has a human-readable label and an optional description. The duplication creates a maintenance problem and, more critically, blocked a typed reference mechanism for `DesignNote.subject`.

`DesignNote` (ADR-0012) used `xsd:anyURI` for its `subject` field as a stopgap because there was no common type to reference. The `xsd:anyURI` approach bypassed TerminusDB's type system entirely, requiring API-layer validation for referential integrity and leaving deletion behavior unspecified.

The authorship question (ADR-0010) also points at a shared base class: when `createdBy` and `updatedBy` are added, they should propagate to all primary artifact types in a single change, not require 13 individual edits.

## Decision
Define `ArmatureDocument` as an abstract base class carrying two fields:
- `label: xsd:string` — required human-readable name
- `description: Optional<xsd:string>` — optional elaboration

~~Thirteen types inherit from `ArmatureDocument`:
`LearningEvidence` (abstract), `LearningDataset`, `LearningNeed`, `LearningObjective`, `PrerequisiteRecord`, `AssessmentItem`, `Response`, `Assessment`, `LearningActivity`, `ActivityGroup`, `Module`, `DesignNote`, `Course`~~
**Twelve types inherit from `ArmatureDocument` as of ADR-0022 (Accepted):
`LearningEvidence` (abstract), `LearningDataset`, `LearningNeed`, `LearningObjective`, `PrerequisiteRecord`, `AssessmentItem`, `Assessment`, `LearningActivity`, `ActivityGroup`, `Module`, `DesignNote`, `Course`.
`Response` removed — item stem and options are embedded on `AssessmentItem`, not modeled as a standalone document.**

> **Later change (2026-10-08):** Thirteen types inherit directly today: the twelve above plus
> `DesignFinding` (ADR-0020). Counting the two concrete evidence subtypes in place of the abstract
> `LearningEvidence`, `ArmatureDocument` has 14 concrete descendants.

`LearningMetric` and `DescriptiveEvidence` inherit `label`/`description` transitively through `LearningEvidence -> ArmatureDocument`.

**Junction and structural documents are excluded:** `NeedEvidenceLink`, `ItemInstance`, `ActivityGroupMember`, `ModuleObjective`, `ModuleActivityLink`, `ModuleActivityGroupLink` do not inherit from `ArmatureDocument`. They are addressed by their relationship fields, not a human-readable name.

> **Later change (2026-10-08):** Junction documents now inherit `DesignRecord`, the abstract root
> above `ArmatureDocument`, so they can be the subject of a note without gaining a name (ADR-0017).
> `PrerequisiteRecord` is the one relationship that inherits `ArmatureDocument`.

**`DesignNote.subject` is retyped** from `Set<xsd:anyURI>` to `Set<ArmatureDocument>` with `@min_cardinality: 1`. TerminusDB now enforces referential integrity natively — subjects must exist, the type system validates at write time, and deletion behavior follows standard document reference semantics (ADR-0002). The API-layer validation workaround described in ADR-0012 is no longer needed for subject existence checks.

> **Later change (2026-10-08):** `subject` is `Set<DesignRecord>` (ADR-0017). TerminusDB v12.0.7
> checks that each subject exists, not its class (platform check L); the class check is the API's
> (constraint 0). "The type system validates at write time" holds only for existence.

## Consequences
- `label` and `description` are defined once and inherited — no duplication, no divergence risk.
- `DesignNote.subject` has typed, schema-enforced referential integrity. Write validation is handled by TerminusDB; deletion of a referenced document follows ADR-0002 reference semantics.
- When authorship fields (`createdBy`, `updatedBy`) are added, they go on `ArmatureDocument` and propagate to all 13 types in a single schema change.
- The hierarchy is two levels for evidence types (`ArmatureDocument -> LearningEvidence -> LearningMetric/DescriptiveEvidence`) and one level for all others. `LearningEvidence` remains a meaningful mid-level abstract capturing evidence-specific fields (`collectedAt`, `source`).

  > **Later change (2026-10-08):** Referential integrity here is existence only, as noted above.
  > `createdBy` was added (ADR-0015) and reaches all 14 concrete descendants; `updatedBy` was never
  > added. With `DesignRecord` above `ArmatureDocument` (ADR-0017), the evidence chain is
  > `DesignRecord -> ArmatureDocument -> LearningEvidence -> LearningMetric | DescriptiveEvidence`.
- Junction documents remain outside the hierarchy. Adding a new primary artifact type requires only `@inherits: "ArmatureDocument"` — no change to `DesignNote` or any other type.
- The `xsd:anyURI` stopgap in `DesignNote.subject` is fully replaced. The open questions about write validation and deletion handling documented in ADR-0012 are resolved by this change.

## Related
ADR-0001 (LearningEvidence abstract base), ADR-0002 (references not ownership), ADR-0010 (authorship deferred), ADR-0012 (DesignNote), ADR-0006 (superseded by ADR-0013; class enforcement is now constraint 0), ADR-0015 (`createdBy`), ADR-0017 (`DesignRecord` root; amends this ADR), ADR-0020 (`DesignFinding`), ADR-0022 (`Response` removed; amends this ADR)
